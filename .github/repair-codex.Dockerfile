FROM ghcr.io/github/gh-aw-firewall/agent:0.28.27@sha256:8d14865f96d57d9b4f22b30b3e148d2d926384f0aa543a139f15593e450f0e90
USER root
RUN curl --fail --silent --show-error --location https://github.com/openai/codex/releases/download/rust-v0.163.0/codex-package-x86_64-unknown-linux-musl.tar.gz -o /tmp/codex.tar.gz \
    && echo '582646c6bf0561eb0de540f7fc85b9121b0091a826bc6e96830b7f1722122182  /tmp/codex.tar.gz' | sha256sum --check \
    && mkdir -p /opt/catalog-codex \
    && tar -xzf /tmp/codex.tar.gz -C /opt/catalog-codex \
    && ln -s /opt/catalog-codex/bin/codex /usr/local/bin/catalog-codex \
    && rm /tmp/codex.tar.gz
ENTRYPOINT ["/bin/bash"]
