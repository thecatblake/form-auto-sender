deploy:
	@printf "Deploying ...\n"
	@printf "Enter commit message: "
	@read msg && \
	git add . && \
	git commit -m "$$msg" && \
	git push my main