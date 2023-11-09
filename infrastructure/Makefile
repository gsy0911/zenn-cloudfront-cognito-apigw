# Makefileがあるところで `$ make`と打つと、実行可能なコマンドと簡単な説明などが一覧で表示されます。
# 各コマンドの前に「@」をつけることで、実行時にコンソールに実行コマンドそのものを表示させないようにしています。

# 定数
ifdef profile
  $(eval exec_profile := $(profile))
else
  $(eval exec_profile := $(AWS_PROFILE))
endif
$(eval AWS_ACCOUNT := $(shell aws sts get-caller-identity --profile $(exec_profile) | jq -r .Account))
REGION := ap-northeast-1


.PHONY: help
help: ## show commands ## make
	@echo "PROFILE:= $(exec_profile), AWS_ACCOUNT:= $(AWS_ACCOUNT)"
	@printf "\033[36m%-30s\033[0m %-50s %s\n" "[Sub command]" "[Description]" "[Example]"
	@grep -E '^[/a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | perl -pe 's%^([/a-zA-Z_-]+):.*?(##)%$$1 $$2%' | awk -F " *?## *?" '{printf "\033[36m%-30s\033[0m %-50s %s\n", $$1, $$2, $$3}'


.PHONY: login
login: ## login to ecr ## make login
	@aws ecr get-login-password | docker login --username AWS --password-stdin https://$(AWS_ACCOUNT).dkr.ecr.$(REGION).amazonaws.com
	@aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws
