# https://cloud5.jp/iam_authorization/
# https://qiita.com/suzuki-navi/items/1ea284c97075f3a34b30

from botocore.awsrequest import AWSRequest
from botocore.auth import SigV4Auth
from typing import List, Optional
from dataclasses import dataclass, field
import boto3
import json
import jwt


client = boto3.client('cognito-identity', region_name='ap-northeast-1')
ACCOUNT_ID = "000000000000"


@dataclass(frozen=True)
class Configuration:
    account_id: str
    region: str
    user_pool_id: str
    identity_pool_id: str
    client_id: str
    service_name: str
    environment: str
    associated_domain: str

    @staticmethod
    def load(path: str) -> "Configuration":
        with open(path, "r") as f:
            data = json.load(f)
        return Configuration(
            account_id=data["AccountId"],
            region=data["Region"],
            user_pool_id=data["UserPoolId"],
            identity_pool_id=data["IdentityPoolId"],
            client_id=data["ClientId"],
            service_name="execute-api",
            environment=data["Environment"],
            associated_domain=data["associatedDomain"]
        )


@dataclass(frozen=True)
class JwtPayload:
    """
    JWTのpayloadを保持するクラス
    """
    sub: str
    email_verified: bool
    iss: str
    cognito_username: str
    cognito_groups: Optional[List[str]]
    cognito_preferred_role: Optional[str]
    cognito_roles: Optional[List[str]]
    origin_jti: str
    aud: str
    event_id: str
    token_use: str
    auth_time: int
    exp: int
    iat: int
    jti: str
    email: str

    @staticmethod
    def of(jwt_: str) -> "JwtPayload":
        data = jwt.decode(jwt_, options={"verify_signature": False})
        cognito_username = data.pop("cognito:username", None)
        cognito_groups = data.pop("cognito:groups", None)
        cognito_preferred_role = data.pop("cognito:preferred_role", None)
        cognito_roles = data.pop("cognito:roles", None)
        data["cognito_username"] = cognito_username
        data["cognito_groups"] = cognito_groups
        data["cognito_preferred_role"] = cognito_preferred_role
        data["cognito_roles"] = cognito_roles
        return JwtPayload(**data)


@dataclass(frozen=True, order=True)
class CustomRoleMapping:
    """
    「cognitoに登録してあるグループに付与されているロール」
    と
    「ドメインに紐づくべきロール」
    のマッピングを管理するクラス。

    本来はidpのみだけで完結できるが、ドメインごとにサービスが存在するためこのようなクラスを作成して
    ドメインごとにロールを付与するようにしている。

    また、このクラスが呼び出されるのはOriginRequestのため、
    associated_hostがAPIのホストになっている

    Examples:
        >>> cognito_roles = []
        >>> host = "..." # host from request
        >>> environment = "stg" # or "prod"
        >>> CustomRoleMapping.configure_role(
        >>>     domain=host,
        >>>     environment=environment,
        >>>     cognito_roles=cognito_roles
        >>> )
    """
    role_name: str = field(compare=False)
    priority: int = field(compare=True)
    associated_domain: str = field(compare=False)
    environment: str = field(compare=False)
    service_name: str = field(compare=False)

    def role_arn(self):
        return f"arn:aws:iam::{ACCOUNT_ID}:role/{self.role_name}"

    @staticmethod
    def load_roles(path: str) -> List["CustomRoleMapping"]:
        with open(path, "r") as f:
            data = json.load(f)
        return [CustomRoleMapping(
            role_name=v["roleName"],
            associated_domain=v["associatedDomain"],
            priority=v["priority"],
            environment=v["environment"],
            service_name=v["serviceName"]
        ) for v in data["roles"]]

    @staticmethod
    def configure_role(domain: str, environment: str, cognito_roles: List[str]) -> Optional["CustomRoleMapping"]:
        prepared_roles = CustomRoleMapping.load_roles(path="role_mapping_configuration.json")
        filtered_roles = [
            role for role in prepared_roles
            if (role.environment == environment)
            and (role.associated_domain == domain)
            and (role.role_arn() in cognito_roles)
        ]
        print(f"role_candidate: {filtered_roles}")
        # この時点でロールが存在しない場合はNoneを返す
        if not filtered_roles:
            return None
        sort_priority = sorted(filtered_roles)
        return sort_priority[0]


def get_credentials_from_id_token(id_token: str, config: Configuration, host: str) -> dict:
    logins = {f"cognito-idp.{config.region}.amazonaws.com/{config.user_pool_id}": id_token}
    decode_jwt = JwtPayload.of(id_token)
    cognito_roles = decode_jwt.cognito_roles
    configured_crm = CustomRoleMapping.configure_role(
        domain=host, environment=config.environment, cognito_roles=cognito_roles
    )

    # identity-poolからidを取得する
    cognito_identity_id = client.get_id(
        AccountId=config.account_id,
        IdentityPoolId=config.identity_pool_id,
        Logins=logins
    )
    # get sessionToken, etc.
    credentials = client.get_credentials_for_identity(
        IdentityId=cognito_identity_id['IdentityId'],
        Logins=logins,
        CustomRoleArn=configured_crm.role_arn()
    )
    print(f"chosen role: {configured_crm.role_arn()}")
    return credentials


def _parse_cookie(cookie_str: str) -> dict:
    parsed_cookie = {}
    for cookie in cookie_str.split(';'):
        if cookie:
            parts = cookie.split('=')
            parsed_cookie[parts[0].strip()] = parts[1].strip()
    return parsed_cookie


def _decode_query_string(query_string: str) -> dict:
    """
    QueryStringからdict形式のparamsを生成する
    """
    if query_string:
        qs_list = [v.split("=") for v in query_string.split("&")]
        return {d[0]: d[1] for d in qs_list}
    else:
        return {}


def handler_for_apigw_origin_request(event, _):
    """
    API Gatewayがoriginになっており、
    そこへのORIGIN_REQUESTとして呼ばれる。

    IAM認証に必要なヘッダーを付与する。
    """
    print(event)
    request = event['Records'][0]['cf']['request']
    headers = request['headers']
    host = headers["host"][0]["value"]
    uri = request["uri"]
    query_string = request["querystring"]
    method = request["method"]
    params = _decode_query_string(query_string=query_string)
    url = f"https://{host}/{uri}"

    if "authorization" not in headers:
        print(f"ERROR: authorization not in headers")
        return request

    id_token = headers["authorization"][0]["value"]

    # 2. Credential生成
    config = Configuration.load("./configuration.json")
    try:
        credentials = get_credentials_from_id_token(id_token=id_token, config=config, host=host)
    except:
        # エラーが発生するのはcognitoのグループに属しておらず
        # Cognito Idpにてロールのマッピングが存在しない場合
        return request

    print("SUCCESS: creating credential")
    session = boto3.session.Session(
        aws_access_key_id=credentials['Credentials']['AccessKeyId'],
        aws_secret_access_key=credentials['Credentials']['SecretKey'],
        aws_session_token=credentials['Credentials']['SessionToken'],
        region_name=config.region
    )

    # 3. AWSRequest生成
    aws_request = AWSRequest(method=method, url=url, params=params)

    # 4. AWSリクエスト署名
    SigV4Auth(session.get_credentials(), 'execute-api', "ap-northeast-1").add_auth(aws_request)

    # 5. headerの作成
    headers_to_append = {
        "x-amz-date": [{"key": "x-amz-date", "value": aws_request.context['timestamp']}],
        "x-amz-security-token": [{"key": "X-Amz-Security-Token", "value": credentials["Credentials"]["SessionToken"]}],
        "authorization": [{"key": "Authorization", "value": aws_request.headers['Authorization']}]
    }
    custom_headers_to_append = {
        "x-id-token": [{"key": "X-Id-Token", "value": id_token}]
    }

    # update headers
    request['headers'].update(headers_to_append)
    request["origin"]["custom"]["customHeaders"].update(custom_headers_to_append)
    print("SUCCESS: request modification complete")
    return request


def handler_for_apigw_viewer_request(event, _):
    print(event)
    request = event['Records'][0]['cf']['request']
    headers = request['headers']

    # authorizationがheaderにある場合は、そのままCFへ渡す
    # 検証などはOriginRequestで行う
    if "authorization" in headers:
        print("SUCCESS: authorization in headers")
        return request

    # cookieが存在しない場合も、そのままCFへ渡す。
    # エラーになって返ってくることを想定している
    if "cookie" not in headers:
        print("ERROR: cookie not in headers")
        return request
    cookie = headers['cookie'][0]["value"]
    cookies = _parse_cookie(cookie_str=cookie)

    prefix = "CognitoIdentityServiceProvider"
    config = Configuration.load("./configuration.json")
    last_auth_user_key = f"{prefix}.{config.client_id}.LastAuthUser"
    last_auth_user = cookies.get(last_auth_user_key)
    if not last_auth_user:
        print("ERROR: last_auth_user not found")
        return request

    id_token_key = f"{prefix}.{config.client_id}.{last_auth_user}.idToken"
    id_token = cookies.get(id_token_key)
    if not id_token:
        print("ERROR: id_token not found")
        return request
    headers_to_append = {
        "authorization": [{"key": "Authorization", "value": id_token}]
    }
    # update headers
    request['headers'].update(headers_to_append)
    print("SUCCESS: authorization in cookies")
    return request
