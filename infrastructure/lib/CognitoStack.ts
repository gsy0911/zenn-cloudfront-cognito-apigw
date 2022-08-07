import {
  Duration,
  aws_iam,
  Stack,
  StackProps,
  RemovalPolicy,
  aws_cognito,
} from 'aws-cdk-lib';
import {
  IdentityPool,
  IdentityPoolProviderUrl,
  RoleMappingMatchType,
  RoleMappingRule,
  UserPoolAuthenticationProvider
} from '@aws-cdk/aws-cognito-identitypool-alpha';
import {Construct} from 'constructs';
import {prefix, environment} from './const';


export interface IAuthorizationRoles {
  environment: environment
  apigwRestApiId: string
  cognito: {
    /** この値は一度このStackをデプロイした後にできるidpのPoolIdを付与する。 */
    identityPoolId: `ap-northeast-1:${string}`
  }
}

export class AuthorizationRolesStack extends Stack {
  constructor(scope: Construct, id: string, params: IAuthorizationRoles, props?: StackProps) {
    super(scope, id, props);

    const accountId = this.account
    // IdentityPoolからassumeできる
    const federatedPrincipal = new aws_iam.FederatedPrincipal("cognito-identity.amazonaws.com", {
      "StringEquals": {
        "cognito-identity.amazonaws.com:aud": params.cognito.identityPoolId
      },
      "ForAnyValue:StringLike": {
        "cognito-identity.amazonaws.com:amr": "authenticated"
      },
    }, "sts:AssumeRoleWithWebIdentity")

    const adminUserOnlyResource: string[] = [
      `arn:aws:execute-api:ap-northeast-1:${accountId}:${params.apigwRestApiId}/v1/GET/admin`,
    ]
    const userResource: string[] = [
      `arn:aws:execute-api:ap-northeast-1:${accountId}:${params.apigwRestApiId}/v1/GET/user`,
    ]
    const adminResource: string[] = []
    adminResource.push(...adminUserOnlyResource)
    adminResource.push(...userResource)

    // AdminのロールとMapping
    new aws_iam.Role(this, 'serviceAdminRole', {
      roleName: `${prefix}-service-admin-${params.environment}`,
      assumedBy: federatedPrincipal,
      inlinePolicies: {
        "executeApi": new aws_iam.PolicyDocument({
          statements: [
            new aws_iam.PolicyStatement({
              effect: aws_iam.Effect.ALLOW,
              resources: adminResource,
              actions: [
                'execute-api:Invoke',
              ]
            })
          ]
        })
      }
    })
    // UserのロールとMapping
    new aws_iam.Role(this, 'serviceUserRole', {
      roleName: `${prefix}-service-user-${params.environment}`,
      assumedBy: federatedPrincipal,
      inlinePolicies: {
        "executeApi": new aws_iam.PolicyDocument({
          statements: [
            new aws_iam.PolicyStatement({
              effect: aws_iam.Effect.ALLOW,
              resources: userResource,
              actions: [
                'execute-api:Invoke',
              ]
            })
          ]
        })
      }
    })
  }
}


export interface ICognitoStack {
  domainPrefix: string
  callbackUrls: `https://${string}/oauth2/idpresponse`[]
  logoutUrls: `https://${string}/signout`[]
}

export class CognitoStack extends Stack {
  constructor(scope: Construct, id: string, params: ICognitoStack, props?: StackProps) {
    super(scope, id, props);

    const userPool = new aws_cognito.UserPool(this, "userPool", {
      userPoolName: `user-pool`,
      // signUp
      // By default, self sign up is disabled. Otherwise, use userInvitation.
      selfSignUpEnabled: false,
      userVerification: {
        emailSubject: "Verify email message",
        emailBody: "Thanks for signing up! Your verification code is {####}",
        emailStyle: aws_cognito.VerificationEmailStyle.CODE,
        smsMessage: "Thanks for signing up! Your verification code is {####}"
      },
      // sign in
      signInAliases: {
        username: true,
        email: true
      },
      // user attributes
      standardAttributes: {
        email: {
          required: true,
          mutable: true
        },
      },
      // role, specify if you want
      mfa: aws_cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: true,
        otp: true
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(3)
      },
      // emails, by default `no-reply@verificationemail.com` used
      accountRecovery: aws_cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.DESTROY,
    })

    // App Clients
    userPool.addClient("privateClient", {
      userPoolClientName: "privateClient",
      generateSecret: true,
      authFlows: {
        userPassword: true,
        userSrp: true
      },
      oAuth: {
        callbackUrls: params.callbackUrls,
        logoutUrls: params.logoutUrls
      }
    })

    // App Clients
    userPool.addClient("publicClient", {
      userPoolClientName: "publicClient",
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true
      },
      oAuth: {
        callbackUrls: params.callbackUrls,
        logoutUrls: params.logoutUrls
      }
    })

    userPool.addDomain("cognito-domain", {
      cognitoDomain: {
        domainPrefix: params.domainPrefix,
      }
    })
  }
}


export interface ICognitoIdentityPool {
  environment: environment
  cognito: {
    userPoolId: `ap-northeast-1_${string}`
    userPoolClientId: string
  }
  iamRole: {
    userRoleArn: `arn:aws:iam::${string}:role/${string}`
    adminRoleArn: `arn:aws:iam::${string}:role/${string}`
  }
}


/**
 * 認可用のIAM RoleとCognitoIdpを作成するStack。
 * roleMappingsRuleを利用することで、単一のIdpで完結するようにしている。
 * マッピングには、JWTに含まれている`cognito:groups`というclaimを利用している。
 */
export class CognitoIdentityPoolStack extends Stack {
  constructor(app: Construct, id: string, params: ICognitoIdentityPool, props?: StackProps) {
    super(app, id, props);

    const adminRole = aws_iam.Role.fromRoleArn(this, "adminRole", params.iamRole.adminRoleArn)
    const userRole = aws_iam.Role.fromRoleArn(this, "userRole", params.iamRole.userRoleArn)

    const adminRMR: RoleMappingRule = {
      claim: "cognito:groups",
      claimValue: `admin.${params.environment}`,
      mappedRole: adminRole,
      matchType: RoleMappingMatchType.CONTAINS
    }

    const userRMR: RoleMappingRule = {
      claim: "cognito:groups",
      claimValue: `user.${params.environment}`,
      mappedRole: userRole,
      matchType: RoleMappingMatchType.CONTAINS
    }

    // CognitoのUserPool
    const userPool = aws_cognito.UserPool.fromUserPoolId(this, 'Pool', params.cognito.userPoolId);
    const userPoolClient = aws_cognito.UserPoolClient.fromUserPoolClientId(this, "client", params.cognito.userPoolClientId)

    new IdentityPool(this, "identity-pool", {
      identityPoolName: `${prefix}-identity-pool-${params.environment}`,
      allowUnauthenticatedIdentities: false,
      authenticatedRole: adminRole,
      authenticationProviders: {
        userPools: [new UserPoolAuthenticationProvider({
          userPool,
          userPoolClient,
        })]
      },
      roleMappings: [{
        providerUrl: IdentityPoolProviderUrl.userPool(`cognito-idp.ap-northeast-1.amazonaws.com/${params.cognito.userPoolId}:${params.cognito.userPoolClientId}`),
        useToken: false,
        resolveAmbiguousRoles: false,
        // 新しいサービスを追加する場合は、ここにmappingを追加すること
        rules: [adminRMR, userRMR]
      }]
    })
  }
}
