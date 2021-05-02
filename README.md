# Example CDK TypeScript Project

To deploy code deployment flow with CodePipeline.

### Resources that this CDK project creates

* S3 bucket
* CloudFront distribution
* Route53 record
* CodePipeline
  * get source from Github
  * place build files to S3 bucket
* Invalidate CloudFront cache with Lambda

### Commands

* `npm install`
* `cdk deploy`

[description](https://note.figmentresearch.com/aws/cdkcodepipeline-github-cloudfront)
