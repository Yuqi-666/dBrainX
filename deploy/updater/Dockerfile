FROM docker:27-cli@sha256:851f91d241214e7c6db86513b270d58776379aacc5eb9c4a87e5b47115e3065c

RUN apk add --no-cache curl jq
COPY watch.sh /usr/local/bin/dbrainx-watch
RUN chmod 755 /usr/local/bin/dbrainx-watch

ENTRYPOINT ["/usr/local/bin/dbrainx-watch"]
