ssh-keygen -t ed25519 -f ~/.ssh/deploy_ansible -C "ansible-deploy"


# server
sudo useradd -m -s /bin/bash deploy
echo "deploy ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/deploy

sudo mkdir -p /home/deploy/.ssh
sudo nano /home/deploy/.ssh/authorized_keys

sudo chown -R deploy:deploy /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh
sudo chmod 600 /home/deploy/.ssh/authorized_keys