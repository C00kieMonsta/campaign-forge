# Campaigns-app assistants. Included from the server block of /etc/nginx/conf.d/campaign-forge.conf
# (the deploy installs this file and adds the include line when it is missing; the bootstrap does
# the same for a new box). Edit here, never on the box.
#
# One model call per request, synchronously: a full email draft or the reading of a photographed
# business card takes longer than the default 60s read timeout. The extract route carries the photo
# or the recording itself (multipart), hence the body size: 12m sits above the app's own 10 MB cap
# so the app's message, not nginx's bare 413, is what the user sees.
location ~ ^/api/admin/(campaigns/assistant/(turn|transcribe)|contacts/assistant/(extract|create))$ {
    proxy_pass           http://localhost:3001;
    proxy_http_version   1.1;
    proxy_set_header     Host $host;
    proxy_set_header     X-Real-IP $remote_addr;
    proxy_set_header     X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header     X-Forwarded-Proto $scheme;
    proxy_read_timeout   600s;
    proxy_send_timeout   600s;
    client_max_body_size 12m;
}

# Full data snapshot (Settings → "Sauvegarde complète"): one zip carrying every table and every
# stored file, built while the browser reads it. Same needs as the pièces bundle: buffering off, or
# nginx spools gigabytes to disk before the browser sees a byte; timeouts raised, because the gap
# between two chunks is an S3 fetch of a scanned bundle and the default is 60s. Authorised by a
# short-lived token in the query string, since a navigation download cannot carry the bearer header.
location = /api/admin/snapshot/download {
    proxy_pass                http://localhost:3001;
    proxy_http_version        1.1;
    proxy_set_header          Host $host;
    proxy_set_header          X-Real-IP $remote_addr;
    proxy_set_header          X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header          X-Forwarded-Proto $scheme;
    proxy_buffering           off;
    proxy_cache               off;
    proxy_read_timeout        600s;
    proxy_send_timeout        600s;
    chunked_transfer_encoding on;
}
