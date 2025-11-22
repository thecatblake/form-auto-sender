deploy:
	@printf "Deploying ..."
	@read msg && \
	git add . && \
	git commit -m "$$msg" && \
	git push my main