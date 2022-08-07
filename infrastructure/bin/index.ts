import {
  App,
  Tags
} from 'aws-cdk-lib';
import * as lib from '../lib';

const app = new App();

const idPrefix = "example-cloudfront-cognito-apigw"
const description = "example@1.0.0"

// Cognito And CognitoIdp
const iamRoles = new lib.AuthorizationRolesStack(app, `${idPrefix}-roles`, lib.paramsAuthorizationRoles, {description})
const cognito = new lib.CognitoStack(app, `${idPrefix}-cognito`, lib.paramsCognitoStack, {description})
const cognitoIdp = new lib.CognitoIdentityPoolStack(app, `${idPrefix}-cognito-idp`, lib.paramsCognitoIdentityPool, {description})

// Lambda@Edge
const cognitoLambdaEdge = new lib.LambdaEdgeAuthStack(
  app,
  `${idPrefix}-lambda-edge`,
  {environment: "prod"},
  {env: lib.envUsEast1, description}
)
const cloudFront1Cognito = new lib.CloudFrontCognitoStack(
  app,
  `${idPrefix}-cloudfront-cognito`,
  {...lib.paramsCloudFrontStack, lambdaEdgeStackId: `${idPrefix}-lambda-edge`},
  {env: lib.envApNortheast1, description}
)

Tags.of(iamRoles).add("project", idPrefix)
Tags.of(cognito).add("project", idPrefix)
Tags.of(cognitoIdp).add("project", idPrefix)
Tags.of(cognitoLambdaEdge).add("project", idPrefix)
Tags.of(cloudFront1Cognito).add("project", idPrefix)


app.synth();
