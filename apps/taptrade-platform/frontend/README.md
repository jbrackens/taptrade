# taptrade-ui

Frontend application for the Tap Trade prediction market

## Requirements

- NVM
- Node v14.9.0
- Yarn v1.17.3

### Pre-requisites

#### .npmrc setup

`npm login --registry=https://lena-srv01.flipsports.net:4566/repository/npm-releases/`

## Usage

- `nvm use`
- `yarn bootstrap`
- `yarn dev`

## Scripts

### Runnable Node.js server

- `build:local` - build version with `.env.local` applied
- `build:dev` - build version with `.env.development` applied
- `build:stage` - build version with `.env.staging` applied
- `build:prod` - build version with `.env.production` applied
- `start:app` - runs bundled &
  [hybrid app](https://nextjs.org/docs/deployment#nodejs-server) from `.next`
  directory as Customer App
- `start:office` - runs bundled &
  [hybrid app](https://nextjs.org/docs/deployment#nodejs-server) from `.next`
  directory as Office

### Static HTMLs

- `build:export:local` - build & optimize version with `.env.local` applied
- `build:export:dev` - build & optimize version with `.env.development` applied
- `build:export:stage` - build & optimize version with `.env.staging` applied
- `build:export:prod` - build & optimize version with `.env.production` applied

### Scoping build scripts

Use `--scope @taptrade-ui/<package_name>` &mdash; for example if we want to
build the staging version of back-office:

```
build:export:stage --scope @taptrade-ui/office
```

## Packages

- **@taptrade-ui/app** - Next.js React Isomorphic App
- **@taptrade-ui/office** - Next.js React Isomorphic Back-Office App
- **@taptrade-ui/utils** - Shared utils, types and other fancy stuff
- **@taptrade-ui/mock-server** - API Mock Server

### Dockerization

- `dockerize:app` - creates a `taptrade-ui/app` Docker image of
  `@taptrade-ui/app` package
- `dockerize:office` - creates a `taptrade-ui/office` Docker image of
  `@taptrade-ui/office` package with `.env.development` applied
- `run-docker:app:dev` - runs `taptrade-ui/app` image on `localhost` (port 3000)
  with `.env.development` applied
- `run-docker:office:stage` - runs `taptrade-ui/office` image on `localhost`
  (port 3000) with `.env.staging` applied

### Using git

When integrating a PR into `develop`:

- rebase, fast-forward (`git merge --ff-only`), squash: OK, all allowed since
  they retain linear history
- 2-parent aka _true_ merge (`git merge --no-ff`): discouraged, coz it tangles
  up the history

When releasing `develop` to `master`:

- rebase, squash: forbidden, since it'd lead to `develop` & `master` histories
  diverging
- fast-forward (`git merge --ff-only develop`): OK, preferred since it retains
  linear history
- 2-parent aka _true_ merge (`git merge --no-ff develop`): OK, tangles up
  history but acceptable if cannot be avoided

Note that `git merge` by default runs in `--ff` mode, which fast-forwards the
branch if possible, and creates a 2-parent merge commit otherwise.

So, in a nutshell, **to release `develop` to `master`**, open a PR from
`develop` to `master`, get it approved & passing the CI check, then execute
`git checkout master && git merge develop && git push -u origin master`.

### Deployment to Kubernetes

#### Prerequisites

Required software:

- [kubectl](https://kubernetes.io/docs/tasks/tools/install-kubectl/)
- [helm v3.x](https://helm.sh/docs/intro/install/)
- [aws-cli](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html)
- [aws-iam-authenticator](https://docs.aws.amazon.com/eks/latest/userguide/install-aws-iam-authenticator.html)
- Ask for AWS credentials to place in `~/.aws/credentials`
- Set the environment variable `AWS_PROFILE=<name of the profile>`
- Get the EKS Kubernetes config file from 1Pass

(Optionally) For convenience you can merge the EKS Kube config file with the
config file you have already in `~/.kube/config`. If you do, then you probably
want to back up the old version just in case (or better yet, put it under local
version control -- git all the things!).

```shell script
cp ~/.kube/config ~/.kube/config-bk-$(date '+%Y_%m_%d__%H_%M_%S') # Back-up just in case
```

Then to merge the config:

```shell script
cp path/to/dowloaded/eks/kubeconfig ~/.kube/eks-kubeconfig
KUBECONFIG=$HOME/.kube/eks-kubeconfig:$HOME/.kube/config kubectl config view --flatten > ~/.kube/merged-config
mv ~/.kube/merged-config ~/.kube/config
```

Once you have all the prerequisites installed, you should just be able to run
`./k8s-operations/deploy_taptrade_ui.sh` script. It will print out the exact
instruction on what params should be passed in order to perform the deployment.
