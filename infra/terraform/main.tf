# VM du cluster K3s de Zelo sur le Proxmox du homelab.
# Terraform crée la machine (image Debian 13, cloud-init) ; Ansible l'installe ensuite (../ansible).

provider "proxmox" {
  endpoint  = var.proxmox_endpoint
  api_token = var.proxmox_api_token
  insecure  = var.proxmox_insecure
}

# Image cloud officielle de Debian 13, importée par l'API Proxmox (pas d'accès SSH au nœud).
resource "proxmox_download_file" "debian" {
  node_name    = var.node
  datastore_id = var.image_datastore
  content_type = "import"
  url          = "https://cloud.debian.org/images/cloud/trixie/latest/debian-13-genericcloud-amd64.qcow2"
  file_name    = "debian-13-genericcloud-amd64.qcow2"
  overwrite    = false # l'image ne sert qu'à la création : pas de retéléchargement à chaque plan
}

resource "proxmox_virtual_environment_vm" "k3s" {
  name        = "zelo-k3s"
  description = "Cluster K3s de Zelo (géré par Terraform, dépôt cytrafps/zelo, infra/terraform)"
  tags        = ["zelo", "k3s", "terraform"]
  node_name   = var.node
  vm_id       = var.vm_id
  on_boot     = true

  # Arrêt propre à la destruction ; l'agent est installé par Ansible.
  stop_on_destroy = true
  agent {
    enabled = false
  }

  cpu {
    cores = var.cores
    type  = "host"
  }

  memory {
    dedicated = var.memory_mb
  }

  disk {
    datastore_id = var.disk_datastore
    import_from  = proxmox_download_file.debian.id
    interface    = "virtio0"
    size         = var.disk_gb
    discard      = "on"
    iothread     = true
  }

  network_device {
    bridge = var.bridge
  }

  operating_system {
    type = "l26"
  }

  serial_device {} # console série : l'image cloud de Debian y écrit son démarrage

  initialization {
    datastore_id = var.disk_datastore
    ip_config {
      ipv4 {
        address = var.ip_cidr
        gateway = var.gateway
      }
    }
    dns {
      servers = var.dns
    }
    user_account {
      username = "zelo"
      keys     = [trimspace(var.ssh_public_key)]
    }
  }

  lifecycle {
    # Changer l'image ou la clé ne doit pas recréer une VM qui tourne : c'est le rôle d'Ansible.
    ignore_changes = [disk[0].import_from, initialization[0].user_account]
  }
}

# Inventaire Ansible écrit à partir de la VM créée.
resource "local_file" "inventory" {
  filename        = "${path.module}/../ansible/inventory.ini"
  file_permission = "0644"
  content         = <<-EOT
    # Généré par Terraform (infra/terraform) : ne pas modifier à la main.
    [k3s]
    zelo-k3s ansible_host=${split("/", var.ip_cidr)[0]} ansible_user=zelo
  EOT
}
