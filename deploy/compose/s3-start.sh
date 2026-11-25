#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# SeaweedFS (Apache-2.0) as the S3-compatible store for import files. Any S3-compatible service works instead.
set -eu
cat > /tmp/s3.json <<JSON
{"identities":[{"name":"opendispatch","credentials":[{"accessKey":"${OPENDISPATCH_S3_ACCESS_KEY}","secretKey":"${OPENDISPATCH_S3_SECRET_KEY}"}],"actions":["Admin","Read","Write","List","Tagging"]}]}
JSON
exec weed server -dir=/data -ip.bind=0.0.0.0 -volume.max=8 -s3 -s3.port=8333 -s3.config=/tmp/s3.json
