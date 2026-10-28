output "ip" {
  value = split("/", var.ip_cidr)[0]
}

output "next" {
  value = "cd ../ansible && ansible-playbook site.yml"
}
