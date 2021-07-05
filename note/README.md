+++
title = "GithubのリポジトリをCodePipelineでCloudFront配信のS3にデプロイする"
date = "2021-04-27"
tags = ["CodePipeline", "Github", "CloudFront"]
+++

ちゃんと書くと長くなってしまうのでタイトルは短くしていますが、つまりGithubのリポジトリをCodePipelineでCloudFrontで配信しているのS3バケットにデプロイする、という仕組みについてです。

[Githubのリポジトリ](https://github.com/suzukiken/cdkcodepipeline-github-cloudfront)

このブログサイトで現時点（2021-04-27）で使っている仕組みです。

このサイトも以前は[CodeCommitにリポジトリを置いてAmplifyコンソールでデプロイしていた](/aws/deploy-hugo-with-amplify-console-by-cdk/)のですが、やはりリポジトリはGithubにある方が何かと便利だなと思ったのと、CodePipelineに慣れておこうと思ってこちらに切り替えました。

で、やってみてわかったのですがSPAみたいなものを用意するだけならやっぱりAmplifyコンソールを使う方が断然楽ですね。[たったこれだけだから。](https://github.com/suzukiken/cdkamphugo/blob/master/lib/cdkamphugo-stack.ts)

逆にAmplifyコンソールを使わないと、以下の諸々全てを自分で書かないといけないのだと気が付かされました。

* S3バケットの用意
* CloudFrontの配信設定
* Route53のレコード作成
* CodePipelineでコードの取得から生成まで
* LambdaでCDNキャッシュのクリア

リポジトリがGithubになったこと若干コードが増えた要因ではありますが、Amplifyコンソールを使うのに比べて[こんなに長くなりました。](https://github.com/suzukiken/cdkcodepipeline-github-cloudfront/blob/master/lib/cdkcodepipeline-github-cloudfront-stack.ts)

とはいえ一度作ってしまえばあとは量産できるのがCDKというかInfrastructure as Codeの良いところなので、今後はAmplifyコンソールは使わずにこちらを使ってゆきたいと思っています。デプロイされた内容をS3で確認できるのは不具合があった時などには便利だし。

ところでInfrastructure as Codeって随分昔流行った言葉だよなという意識はあって、CDKはそれの1つではあると思うのともちろんCDK以前にServerlessだったり、当然CloudFormationがベースにあるのだからCDK以前から可能だったことなわけで特に新しいことではないのですが、最近AWSとかもちろんGCPやAzureや中国のクラウドもそうなのでしょうけど、それらが必要な機能を少しずつ増やして来たことで、Infrastructure as Codeという言葉はもう少し違う解釈ができるのかもしれないと思う。つまり今までは「デプロイメント作業をコード化する」ものとしてInfrastructure as Codeが捉えられてきたように思うし、いやそもそもそれ以上の意味はないのかもしれないし、自分が上で量産云々と書いたところはまさにそういう意味でInfrastructure as Codeという言葉を使っているのですが、Infrastructure as Codeという言葉をもう一度よーく考えてみると「インフラがコードの代わりになる」という風に捉えられるように思う。英語ネイティブじゃないからこの解釈が間違っていたら恥ずかしいけど、自分がAWS CDKを良いなあと思うのは「コードの代わりにインフラを書ける」からで、それがinfrastructure as codeという英語本来の意味なんじゃないのかな。とか、唐突に私の考えを書いてみた。

話は変わって、GithubからCodePipelineにソースコードを取り込む部分では[Githubのパーソナルアクセストークン](https://docs.github.com/en/github/authenticating-to-github/creating-a-personal-access-token)を使うのではなく、Github Appの方を利用している。こちらはAWSの推奨する「GitHub version 2 source action」の方ということになる。

[AWSのドキュメント](https://docs.aws.amazon.com/codepipeline/latest/userguide/update-github-action-connections.html)と
[Githubのドキュメント](https://docs.github.com/en/developers/apps/differences-between-github-apps-and-oauth-apps)の両方を見て多分こういうことだろうと思うのでここに整理しておく。

| AWSの推奨 | Githubでの分類 | Personal access tokens | AWS CodePipelineでの呼称       |
|-----------|----------------|------------------------|--------------------------------|
| 非推奨    | OAuth apps     | 要発行                 | GitHub version 1 source action |
| 推奨      | GitHub Apps    | 不要                   | GitHub version 2 source action |
