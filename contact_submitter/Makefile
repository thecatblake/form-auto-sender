NAME=contact_submitter

restart:
	sudo systemctl daemon-reload
	sudo systemctl restart $(NAME)

status:
	sudo systemctl status $(NAME)

log:
	sudo journalctl -u $(NAME)