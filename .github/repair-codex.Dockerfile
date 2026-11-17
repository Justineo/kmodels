FROM ghcr.io/github/gh-aw-firewall/agent:0.28.27@sha256:8d14865f96d57d9b4f22b30b3e148d2d926384f0aa543a139f15593e450f0e90
USER root
RUN curl --fail --silent --show-error --location https://github.com/openai/codex/releases/download/rust-v0.163.0/codex-x86_64-unknown-linux-musl.tar.gz -o /tmp/codex.tar.gz \
    && echo 'beb339e8ecd9ba057a6bb2dc81ad8ca474812edfbf0fc5056ca818797648dde4  /tmp/codex.tar.gz' | sha256sum --check \
    && tar -xzf /tmp/codex.tar.gz -C /usr/local/bin \
    && mv /usr/local/bin/codex-x86_64-unknown-linux-musl /usr/local/bin/catalog-codex \
    && rm /tmp/codex.tar.gz
ENTRYPOINT ["/bin/bash"]
