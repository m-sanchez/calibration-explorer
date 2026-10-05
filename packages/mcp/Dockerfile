FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1

ARG PACKAGE=@m-sanchez/calibration-explorer-mcp@0.2.0
RUN npm install --global --no-audit --no-fund "$PACKAGE" \
 && npm cache clean --force \
 && mkdir -p /data/input /data/output \
 && chown node:node /data/output

USER node
WORKDIR /data
ENTRYPOINT ["calibration-explorer-mcp"]
CMD ["--input-root", "/data/input", "--output-root", "/data/output"]
