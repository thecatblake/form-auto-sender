provider "aws" {
  region = "ap-northeast-1"
}

data "aws_ami" "ubuntu" {
  most_recent = true

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  owners = ["099720109477"] # Canonical
}

resource "aws_key_pair" "app_server" {
  key_name   = "formautosender"
  public_key = file("~/.ssh/deploy_ansible.pub")
}

locals {
  deploy_pubkey = chomp(file("~/.ssh/deploy_ansible.pub"))
}

resource "aws_instance" "app_server" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = "c5a.xlarge"
  key_name      = aws_key_pair.app_server.key_name

  user_data = <<-CLOUD
    #cloud-config
    users:
      - name: deploy
        shell: /bin/bash
        groups: [sudo]
        sudo: "ALL=(ALL) NOPASSWD:ALL"
        ssh-authorized-keys:
          - ${local.deploy_pubkey}
    write_files:
      - path: /etc/ssh/sshd_config.d/10-shardening.conf
        permissions: "0644"
        content: |
          PasswordAuthentication no
          PermitRootLogin prohibit-password
    runcmd:
      - [ mkdir, -p, /home/deploy/.ssh ]
      - [ chown, -R, "deploy:deploy", "/home/deploy/.ssh" ]
      - [ chmod, "700", "/home/deploy/.ssh" ]
      - [ chmod, "600", "/home/deploy/.ssh/authorized_keys" ]
      - [ systemctl, restart, sshd]
  CLOUD

  root_block_device {
    volume_size = 50
    volume_type = "gp3"
    encrypted   = true
  }

  tags = {
    Name = "form-auto-sender-server"
  }
}
