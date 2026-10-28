variable "proxmox_endpoint" {
  description = "URL de l'API Proxmox, par exemple https://192.168.1.10:8006/"
  type        = string
}

variable "proxmox_api_token" {
  description = "Jeton d'API Proxmox, « utilisateur@realm!nom=secret » (voir README)"
  type        = string
  sensitive   = true
}

variable "proxmox_insecure" {
  description = "Accepte le certificat auto-signé de Proxmox (homelab)"
  type        = bool
  default     = true
}

variable "node" {
  description = "Nœud Proxmox qui héberge la VM"
  type        = string
  default     = "pve"
}

variable "image_datastore" {
  description = "Stockage où télécharger l'image Debian ; le type de contenu « Import » doit y être activé"
  type        = string
  default     = "local"
}

variable "disk_datastore" {
  description = "Stockage du disque de la VM"
  type        = string
  default     = "local-lvm"
}

variable "bridge" {
  description = "Pont réseau Proxmox"
  type        = string
  default     = "vmbr0"
}

variable "vm_id" {
  description = "Identifiant Proxmox de la VM"
  type        = number
  default     = 210
}

variable "cores" {
  type    = number
  default = 4
}

variable "memory_mb" {
  description = "Mémoire de la VM : K3s, Argo CD, Prometheus, PostGIS, Valhalla et l'API tiennent dans 6 Go"
  type        = number
  default     = 6144
}

variable "disk_gb" {
  type    = number
  default = 40
}

variable "ip_cidr" {
  description = "Adresse fixe de la VM, par exemple 192.168.1.89/24"
  type        = string
}

variable "gateway" {
  type = string
}

variable "dns" {
  type    = list(string)
  default = ["1.1.1.1", "9.9.9.9"]
}

variable "ssh_public_key" {
  description = "Clé publique SSH autorisée pour l'utilisateur zelo (Ansible s'y connecte)"
  type        = string
}
