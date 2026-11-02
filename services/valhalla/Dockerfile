# Valhalla avec le graphe routier de la Marne embarqué (construit par build.sh en CI).
# Le service ne fait que lire ces fichiers : aucune construction au démarrage (0,4 s).
FROM ghcr.io/valhalla/valhalla-scripted@sha256:2dab557c4786a411d6eb814f2bf6f927e56ff8b89df4b9412c89437fe59f93d9
COPY data/valhalla.json data/valhalla_tiles.tar data/admins.sqlite data/timezones.sqlite data/default_speeds.json data/marne.state.txt /custom_files/
USER 65534:65534
EXPOSE 8002
# Deux fils de calcul : un trajet long ne bloque pas les autres.
ENTRYPOINT ["valhalla_service", "/custom_files/valhalla.json", "2"]
