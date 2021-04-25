import * as cdk from '@aws-cdk/core';
import * as s3 from '@aws-cdk/aws-s3';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as codepipeline_actions from '@aws-cdk/aws-codepipeline-actions';
import * as acm from "@aws-cdk/aws-certificatemanager";
import * as cloudfront from '@aws-cdk/aws-cloudfront';
import * as origins from '@aws-cdk/aws-cloudfront-origins';
import * as route53 from '@aws-cdk/aws-route53';
import * as targets from "@aws-cdk/aws-route53-targets/lib";
import * as lambda from '@aws-cdk/aws-lambda';
import { PythonFunction } from '@aws-cdk/aws-lambda-python';
import * as iam from '@aws-cdk/aws-iam';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';

export class CdkcodepipelineGithubCloudfrontStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    const PREFIX = id.toLowerCase().replace('stack', '')

    const domain = this.node.tryGetContext('domain')
    const subdomain = this.node.tryGetContext('subdomain')
    const acmarn = cdk.Fn.importValue(this.node.tryGetContext('crossregion-acmarn-exportname'))
    const repository = this.node.tryGetContext('github-repository-name')
    const owner = this.node.tryGetContext('github-owner-name')
    const branch = this.node.tryGetContext('github-branch-name')
    const baseurl = 'https://' + subdomain + '.' + domain + '/'
    const smname = this.node.tryGetContext('github-connection-codestararn-smname')
    
    const codestararn = secretsmanager.Secret.fromSecretNameV2(this, 'secret', smname).secretValue.toString()
    
    // bucket
    
    const bucket = new s3.Bucket(this, 'bucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      websiteIndexDocument: "index.html",
      websiteErrorDocument: "error.html",
      publicReadAccess: true,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.HEAD,
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.DELETE,
          ],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
          exposedHeaders: [
            "x-amz-server-side-encryption",
            "x-amz-request-id",
            "x-amz-id-2",
            "ETag",
          ],
          maxAge: 3000,
        },
      ],
    })

    const certificate = acm.Certificate.fromCertificateArn(this, 'certificate', acmarn)
    
    const distribution = new cloudfront.Distribution(this, 'distribution', {
      defaultBehavior: { 
        origin: new origins.S3Origin(bucket)
      },
      domainNames: [cdk.Fn.join(".", [subdomain, domain])],
      certificate: certificate,
    })
    
    const zone = route53.HostedZone.fromLookup(this, "zone", {
      domainName: domain,
    })
    
    const record = new route53.ARecord(this, "record", {
      recordName: subdomain,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution)
      ),
      zone: zone,
    })
    
    // code pipeline
    
    const pipeline_project = new codebuild.PipelineProject(this, 'pipeline_project', {
      buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec.yml'), // this line is not necessary. 
      environmentVariables: {
        BASEURL: { value: baseurl }
      }
    })
    
    const source_output = new codepipeline.Artifact();
    const build_output = new codepipeline.Artifact();
    
    // To use GitHub version 2 source action
    // https://github.com/aws/aws-cdk/issues/11582
    const source_action = new codepipeline_actions.BitBucketSourceAction({
      actionName: PREFIX + '-sourceaction',
      owner: owner,
      repo: repository,
      connectionArn: codestararn,
      output: source_output,
      branch: branch,
    })
    
    /*
    GitHubSourceAction doesnt support GitHub version 2 source action
    const source_action = new codepipeline_actions.GitHubSourceAction({
      actionName: PREFIX + '-sourceaction',
      owner: owner,
      repo: repository,
      oauthToken: cdk.SecretValue.secretsManager('gitHub-access-token'),
      output: source_output,
      branch: branch,
    })
    */
    
    /*
    // Want to use submodule but couldnt find how
    // GitHubSourceAction does not have fetchSubmodules.
    // https://github.com/aws/aws-cdk/issues/11399
    const gitHubSource = codebuild.Source.gitHub({
      owner: owner,
      repo: repository,
      fetchSubmodules: true, 
    })
    */

    const build_action = new codepipeline_actions.CodeBuildAction({
      actionName: PREFIX + '-buildaction',
      project: pipeline_project,
      input: source_output,
      outputs: [build_output],
      executeBatchBuild: false,
    })
    
    const deploy_action = new codepipeline_actions.S3DeployAction({
      actionName: PREFIX + '-deployaction',
      input: build_output,
      bucket: bucket,
    })

    // Lambda to invalidate CloudFront cache
    
    const invalidate_role = new iam.Role(this, "invalidate_role", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    })

    invalidate_role.attachInlinePolicy(new iam.Policy(this, 'cloudfront_policy', {
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "cloudfront:CreateInvalidation",
            "cloudfront:GetDistribution"
          ],
          resources: [
            "*"
          ]
        })
      ]
    }));
    
    invalidate_role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "AWSCodePipelineCustomActionAccess",
      )
    )
    
    invalidate_role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSLambdaBasicExecutionRole"
      )
    )
    
    // Lambda of Dynamo Stream Poller
    
    const invalidate_function = new PythonFunction(this, "invalidate_function", {
      entry: "lambda",
      index: "invalidate-cloudfront.py",
      handler: "lambda_handler",
      runtime: lambda.Runtime.PYTHON_3_8,
      role: invalidate_role,
      timeout: cdk.Duration.seconds(10),
      environment: {
        DISTRIBUTION_ID: distribution.distributionId
      }
    })
    
    const invalidate_action = new codepipeline_actions.LambdaInvokeAction({
      lambda: invalidate_function,
      actionName: PREFIX + '-invalidate-action'
    })

    const pipeline = new codepipeline.Pipeline(this, 'pipeline', {
      pipelineName: PREFIX + '-pipeline',
      stages: [
        {
          stageName: 'source',
          actions: [source_action],
        },
        {
          stageName: 'build',
          actions: [build_action],
        },
        {
          stageName: 'deploy',
          actions: [deploy_action, invalidate_action],
        }
      ],
    })
    
    new cdk.CfnOutput(this, 's3-bucketname-output', { value: bucket.bucketName })
    
  }
}
