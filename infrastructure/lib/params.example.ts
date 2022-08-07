import { ICloudFrontCognitoStack } from './CloudFrontCognitoStack';
import {
  ICognitoStack,
  IAuthorizationRoles,
  ICognitoIdentityPool,
} from './CognitoStack';
import { ILambdaApigwCfIntegrated } from './LambdaApigwIntegratedStacks';
import {
  Environment
} from 'aws-cdk-lib';

const newlyGenerateS3BucketBaseName: string = "newly-generate-s3-bucket-base-name"
const accountId: string = "00001111222"
const domain: string = "your.domain.com"
const referer: string = "referer-using-s3-cognito"
const applicationDomain: string = `app.${domain}`
const apigwDomain: `api-gw.${string}` = `api-gw.${domain}`
const apiDomain: `api.${string}` = `api.${domain}`
const cognitoDomainPrefix: string = "cognito-unique-domain-example"

export const paramsCloudFrontStack: ICloudFrontCognitoStack = {
  s3: {
    bucketName: `${newlyGenerateS3BucketBaseName}-1`,
    referer: referer
  },
  cloudfront: {
    certificate: `arn:aws:acm:us-east-1:${accountId}:certificate/{unique-id}`,
    domainNames: [applicationDomain],
    route53DomainName: domain,
    route53RecordName: applicationDomain
  },
  lambdaEdgeStackId: ""
}


export const paramsCognitoStack: ICognitoStack = {
  domainPrefix: cognitoDomainPrefix,
  callbackUrls: [`https://${applicationDomain}/oauth2/idpresponse`],
  logoutUrls: [`https://${applicationDomain}/signout`]
}

export const envApNortheast1: Environment = {
  account: accountId,
  region: "ap-northeast-1"
}

export const envUsEast1: Environment = {
  account: accountId,
  region: "us-east-1"
}
