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
