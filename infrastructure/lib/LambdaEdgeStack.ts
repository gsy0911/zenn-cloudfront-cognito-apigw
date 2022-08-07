import {Construct} from "constructs";
import {
  aws_iam,
  aws_lambda,
  aws_lambda_nodejs,
  Stack,
  StackProps
} from "aws-cdk-lib";
import {XRegionParam} from "./XRegionParam";
import {PythonFunction, PythonFunctionProps} from '@aws-cdk/aws-lambda-python-alpha';
import {prefix, environment} from './const';

interface ILambdaEdgeAuthStack {
  environment: environment
}

interface IRegisterAndPublish {
  constructor: Construct
  environment: environment
  id: string
  lambdaNamePrefix: string
  lambdaFunction: aws_lambda.Function
}


const registerSsmAndPublishFunctionAlias = (props: IRegisterAndPublish) => {
  new aws_lambda.Alias(props.constructor, `${props.lambdaNamePrefix}Alias`, {
    aliasName: 'latest',
    version: props.lambdaFunction.currentVersion,
  })
  new XRegionParam(props.constructor, `x-region-param-${props.lambdaNamePrefix}`, {
    region: "ap-northeast-1"
  }).putSsmParameter({
    parameterName: `/${prefix}/${props.environment}/${props.id}/${props.lambdaNamePrefix}`,
    parameterValue: `${props.lambdaFunction.functionArn}:${props.lambdaFunction.currentVersion.version}`,
    parameterDataType: "text",
    idName: `x-region-param-id-${props.id}`
  })
}

interface IDefLambdaFunctionProps {
  constructor: Construct
  environment: environment
  id: string
  lambdaNamePrefix: string
  dirName: string
  role: aws_iam.IRole
  /**
   * - authn(AuthN):  認証に関するLambdaEdge
   * - authz(AuthZ): 認可に関するLambdaEdge
   * */
  functionResponsibility: "authn" | "authz"
  handler: "handler" | string
}

const defNodejsFunction = (props: IDefLambdaFunctionProps): aws_lambda_nodejs.NodejsFunction => {

  const functionProps: aws_lambda_nodejs.NodejsFunctionProps = {
    functionName: `${props.lambdaNamePrefix}-edge-${props.environment}`,
    entry: `./lib/lambda/${props.functionResponsibility}_edge/${props.dirName}/index.ts`,
    handler: props.handler,
    role: props.role,
    bundling: {
      preCompilation: true,
      loader: {
        ".html": "text"
      }
    },
    runtime: aws_lambda.Runtime.NODEJS_14_X,
    architecture: aws_lambda.Architecture.X86_64,
    awsSdkConnectionReuse: false,
  }

  const lambdaFunction = new aws_lambda_nodejs.NodejsFunction(props.constructor, props.lambdaNamePrefix, functionProps)
  registerSsmAndPublishFunctionAlias({
    constructor: props.constructor,
    environment: props.environment,
    id: props.id,
    lambdaNamePrefix: props.lambdaNamePrefix,
    lambdaFunction,
  })
  return lambdaFunction
}

const defPythonFunction = (props: IDefLambdaFunctionProps): PythonFunction => {
  const functionProps: PythonFunctionProps = {
    functionName: `${props.lambdaNamePrefix}-edge-${props.environment}`,
    entry: `./lib/lambda/${props.functionResponsibility}_edge/${props.dirName}`,
    index: "index.py",
    handler: props.handler,
    role: props.role,
    runtime: aws_lambda.Runtime.PYTHON_3_9,
    architecture: aws_lambda.Architecture.X86_64,
  }

  const lambdaFunction = new PythonFunction(props.constructor, props.lambdaNamePrefix, functionProps)
  registerSsmAndPublishFunctionAlias({
    constructor: props.constructor,
    environment: props.environment,
    id: props.id,
    lambdaNamePrefix: props.lambdaNamePrefix,
    lambdaFunction,
  })
  return lambdaFunction
}

export class LambdaEdgeAuthStack extends Stack {
  constructor(scope: Construct, id: string, params: ILambdaEdgeAuthStack, props?: StackProps) {
    super(scope, id, props);

    /** lambda role */
    const role = new aws_iam.Role(this, 'lambdaRole', {
      roleName: `${id}-lambda-role`,
      assumedBy: new aws_iam.CompositePrincipal(
        new aws_iam.ServicePrincipal('lambda.amazonaws.com'),
        new aws_iam.ServicePrincipal('edgelambda.amazonaws.com'),
      ),
      managedPolicies: [
        aws_iam.ManagedPolicy.fromManagedPolicyArn(this, 'CWFullAccess', 'arn:aws:iam::aws:policy/CloudWatchFullAccess')
      ]
    })

    defNodejsFunction({
      constructor: this,
      environment: params.environment,
      id,
      lambdaNamePrefix: "parseAuth",
      dirName: "parse-auth",
      role: role,
      functionResponsibility: "authn",
      handler: "handler"
    })

    defNodejsFunction({
      constructor: this,
      environment: params.environment,
      id,
      lambdaNamePrefix: "checkAuth",
      dirName: "check-auth",
      role: role,
      functionResponsibility: "authn",
      handler: "handler"
    })

    defNodejsFunction({
      constructor: this,
      environment: params.environment,
      id,
      lambdaNamePrefix: "refreshAuth",
      dirName: "refresh-auth",
      role: role,
      functionResponsibility: "authn",
      handler: "handler"
    })

    defNodejsFunction({
      constructor: this,
      environment: params.environment,
      id,
      lambdaNamePrefix: "httpHeaders",
      dirName: "http-headers",
      role: role,
      functionResponsibility: "authn",
      handler: "handler"
    })

    defNodejsFunction({
      constructor: this,
      environment: params.environment,
      id,
      lambdaNamePrefix: "signOut",
      dirName: "sign-out",
      role: role,
      functionResponsibility: "authn",
      handler: "handler"
    })

    defNodejsFunction({
      constructor: this,
      environment: params.environment,
      id,
      lambdaNamePrefix: "trailingSlash",
      dirName: "rewrite-trailing-slash",
      role: role,
      functionResponsibility: "authn",
      handler: "handler"
    })

    defPythonFunction({
      constructor: this,
      environment: params.environment,
      id,
      lambdaNamePrefix: `parseIdTokenToCredential-OR`,
      dirName: "parse-id-token-to-credential-py",
      role,
      functionResponsibility: "authz",
      handler: "handler_for_apigw_origin_request"
    })
  }
}
