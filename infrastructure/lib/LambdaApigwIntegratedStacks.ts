import {
  aws_apigateway,
  aws_certificatemanager as acm,
  aws_cloudfront,
  aws_cloudfront_origins,
  aws_iam,
  aws_lambda,
  aws_route53,
  aws_route53_targets,
  aws_ssm,
  Duration,
  Fn,
  Stack,
  StackProps,
} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {PythonFunction} from '@aws-cdk/aws-lambda-python-alpha';
import {environment, prefix} from './const';


export interface ILambdaApigwCfIntegrated {
  environment: environment
  apigw: {
    certificate: `arn:aws:acm:ap-northeast-1:${string}:certificate/${string}`
    route53DomainName: string
    route53RecordName: `api-gw.${string}`
    basePath: "v1"
  }
  cloudfront: {
    /** us-east-1のACMのARN*/
    certificate: `arn:aws:acm:us-east-1:${string}:certificate/${string}`
    route53DomainName: string
    route53RecordName: `api.${string}`
  }
  lambdaEdgeStackId: `lambda-edge-${environment}`
}

/**
 * API Gatewayから呼び出されるLambdaを一括管理するStack
 * このStackには運用中のLambdaが定義される。
 *
 * API Gatewayのカスタムドメインの設定やURLのパス設計もここで行っている
 */
export class LambdaApigwCfIntegratedStack extends Stack {
  constructor(app: Construct, id: string, params: ILambdaApigwCfIntegrated, props?: StackProps) {
    super(app, id, props);

    const lambdaRoleArn = Fn.importValue(`${prefix}:${params.environment}:LambdaRoleArn`);
    const role = aws_iam.Role.fromRoleArn(this, "lambdaRole", lambdaRoleArn)

    // Lambdaの定義
    const lambdaHandlers = new PythonFunction(this, "lambdaHandler", {
      functionName: `${prefix}-lambda-handler-${params.environment}`,
      entry: './lib/lambda/endpoint',
      index: 'handler.py',
      handler: "lambda_handler",
      runtime: aws_lambda.Runtime.PYTHON_3_9,
      timeout: Duration.seconds(30),
      memorySize: 512,
      allowPublicSubnet: true,
      role,
    })
    // integrationの定義
    const integrationLambdaHandlers = new aws_apigateway.LambdaIntegration(lambdaHandlers)

    // # API Gatewayの定義
    const api = new aws_apigateway.RestApi(this, 'apis', {
      restApiName: `${prefix}-apigw-endpoint-${params.environment}`,
      defaultIntegration: integrationLambdaHandlers,
      deployOptions: {
        stageName: params.apigw.basePath
      },
      defaultCorsPreflightOptions: {
        allowOrigins: ["*"]
      },
      // defaultのエンドポイントの無効化
      disableExecuteApiEndpoint: true
    })

    // ## adminのAPI
    const adminRoot = api.root.addResource('admin');
    adminRoot.addMethod('GET', integrationLambdaHandlers, {
      authorizationType: aws_apigateway.AuthorizationType.IAM
    })
    // ## userのAPI
    const userRoot = api.root.addResource('user');
    userRoot.addMethod('GET', integrationLambdaHandlers, {
      authorizationType: aws_apigateway.AuthorizationType.IAM
    })

    // カスタムドメインの設定: apigwそのもののドメイン設定（api-gw.{your.domain.com}）
    const apigwCustomDomainName = new aws_apigateway.DomainName(this, 'CustomDomain', {
      certificate: acm.Certificate.fromCertificateArn(this, 'Certificate', params.apigw.certificate),
      domainName: params.apigw.route53RecordName,
      endpointType: aws_apigateway.EndpointType.REGIONAL
    });
    // Route 53 for cloudfront
    const hostedZone = aws_route53.HostedZone.fromLookup(this, "cloudfront-hosted-zone", {
      domainName: params.apigw.route53DomainName
    })
    new aws_route53.ARecord(this, 'SampleARecord', {
      zone: hostedZone,
      recordName: params.apigw.route53RecordName,
      target: aws_route53.RecordTarget.fromAlias(new aws_route53_targets.ApiGatewayDomain(apigwCustomDomainName))
    });
    apigwCustomDomainName.addBasePathMapping(api, {
      basePath: params.apigw.basePath
    })

    // カスタムドメインの設定: フロントから叩くことを想定したドメイン設定（api.{your.domain.com}）
    const parseIdTokenToCredentialORVersionParam = aws_ssm.StringParameter.fromStringParameterAttributes(this, 'parseIdTokenToCredentialORSsmParam', {
      parameterName: `/${prefix}/${params.environment}/${params.lambdaEdgeStackId}/parseIdTokenToCredential-OR`,
    }).stringValue;
    const parseIdTokenToCredentialVRVersionParam = aws_ssm.StringParameter.fromStringParameterAttributes(this, 'parseIdTokenToCredentialVRSsmParam', {
      parameterName: `/${prefix}/${params.environment}/${params.lambdaEdgeStackId}/parseIdTokenToCredential-VR`,
    }).stringValue;

    const parseIdTokenToCredentialORVersion = aws_lambda.Version.fromVersionArn(this, "parseIdTokenToCredentialORVersionArnVersion", parseIdTokenToCredentialORVersionParam)
    const parseIdTokenToCredentialVRVersion = aws_lambda.Version.fromVersionArn(this, "parseIdTokenToCredentialVRVersionArnVersion", parseIdTokenToCredentialVRVersionParam)

    const certificate = acm.Certificate.fromCertificateArn(this, "virginiaCertificate", params.cloudfront.certificate)
    const distribution = new aws_cloudfront.Distribution(this, "api-distribution", {
      defaultBehavior: {
        origin: new aws_cloudfront_origins.HttpOrigin(params.apigw.route53RecordName),
        allowedMethods: aws_cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: new aws_cloudfront.CachePolicy(this, "cache-policy", {
          cachePolicyName: `api-distribution-cp-${params.environment}`,
          headerBehavior: aws_cloudfront.CacheHeaderBehavior.allowList(
            "Authorization",
            "Accept-Encoding"
          ),
          minTtl: Duration.seconds(0),
          maxTtl: Duration.seconds(1),
          defaultTtl: Duration.seconds(0),
          queryStringBehavior: aws_cloudfront.CacheQueryStringBehavior.all()
        }),
        originRequestPolicy: new aws_cloudfront.OriginRequestPolicy(this, "origin-request-policy", {
          originRequestPolicyName: `api-distribution-orp-${params.environment}`,
          headerBehavior: aws_cloudfront.OriginRequestHeaderBehavior.allowList(
            "Accept",
            "Accept-Language",
            "Access-Control-Request-Headers",
            "Access-Control-Request-Method",
            "Origin"),
          cookieBehavior: aws_cloudfront.OriginRequestCookieBehavior.all(),
          queryStringBehavior: aws_cloudfront.OriginRequestQueryStringBehavior.all()
        }),
        responseHeadersPolicy: aws_cloudfront.ResponseHeadersPolicy.fromResponseHeadersPolicyId(this, "response-header-policy", "{policy-id}"),
        viewerProtocolPolicy: aws_cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        edgeLambdas: [
          {
            eventType: aws_cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
            functionVersion: parseIdTokenToCredentialORVersion,
            includeBody: true
          },
          {
            eventType: aws_cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
            functionVersion: parseIdTokenToCredentialVRVersion,
            includeBody: true
          },
        ],
      },
      certificate: certificate,
      domainNames: [params.cloudfront.route53RecordName],
      sslSupportMethod: aws_cloudfront.SSLMethod.SNI,
      minimumProtocolVersion: aws_cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021
    })
    // Route 53 for cloudfront
    const cloudfrontHostedZone = aws_route53.HostedZone.fromLookup(this, "cf-hosted-zone", {
      domainName: params.cloudfront.route53DomainName
    })
    new aws_route53.ARecord(this, "cf-a-record", {
      zone: cloudfrontHostedZone,
      recordName: params.cloudfront.route53RecordName,
      target: aws_route53.RecordTarget.fromAlias(new aws_route53_targets.CloudFrontTarget(distribution))
    })

  }
}
