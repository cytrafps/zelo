#!/bin/sh
# Sauvegarde quotidienne de la base (service « backup » de compose.yaml) : pg_dump au format
# personnalisé dans /backups, à BACKUP_HOUR heure de Paris, puis suppression au-delà de KEEP_DAYS
# jours. Une sauvegarde est faite au démarrage s'il n'y en a pas encore aujourd'hui.
set -eu
: "${BACKUP_HOUR:=3}" "${KEEP_DAYS:=14}"
export TZ=Europe/Paris

dump() {
	name="/backups/zelo-$(date +%Y%m%d-%H%M).dump"
	# Écrit d'abord dans un .part : une sauvegarde interrompue ne passe jamais pour complète.
	pg_dump -Fc --no-owner -f "$name.part" && mv "$name.part" "$name"
	find /backups -name 'zelo-*.dump' -mtime +"$KEEP_DAYS" -delete
	find /backups -name '*.part' -mmin +60 -delete
	echo "sauvegarde $name ($(du -h "$name" | cut -f1))"
}

ls /backups/zelo-"$(date +%Y%m%d)"-*.dump >/dev/null 2>&1 || dump
while :; do
	now=$(date +%s)
	next=$(date -d "$(date +%Y-%m-%d) $BACKUP_HOUR:00" +%s 2>/dev/null || date -D '%Y-%m-%d %H:%M' -d "$(date +%Y-%m-%d) $BACKUP_HOUR:00" +%s)
	[ "$next" -le "$now" ] && next=$((next + 86400))
	sleep $((next - now))
	dump || echo "sauvegarde en échec" >&2
done
