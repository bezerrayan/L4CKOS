import { digest, fail, TARGET } from './policy';
import type { RemoteIdentity } from './capability';

/** Command specification only. The executable is a FILE so stdin remains a
 * live control channel. The credential is the first private stdin frame, never
 * an argument, provider variable, artifact, or stdout field. */
export function operatorTransport(identity: RemoteIdentity, payloadSha256: string, socket?:{mysqlDeployment:string,nodeSha256:string,nodeGzipBytes:number}) {
  if (digest(identity.target) !== digest(TARGET) ||
      !/^[a-f0-9-]{36}$/.test(identity.deploymentId) ||
      !/^[a-f0-9]{64}$/.test(payloadSha256)) fail('TRANSPORT_IDENTITY_REQUIRED');
  if(socket) {
    if(!/^[a-f0-9-]{36}$/.test(socket.mysqlDeployment)||!/^[a-f0-9]{64}$/.test(socket.nodeSha256)||!Number.isSafeInteger(socket.nodeGzipBytes)||socket.nodeGzipBytes<1||socket.nodeGzipBytes>100*1024*1024)fail('SOCKET_TRANSPORT_RUNTIME_REQUIRED');
    const script=`set -eu
test "$RAILWAY_PROJECT_ID" = "${TARGET.projectId}"
test "$RAILWAY_ENVIRONMENT_ID" = "${TARGET.environmentId}"
test "$RAILWAY_SERVICE_ID" = "${TARGET.mysqlServiceId}"
test "$RAILWAY_DEPLOYMENT_ID" = "${socket.mysqlDeployment}"
umask 077
directory="$(mktemp -d /var/tmp/l4ckos-operator.XXXXXXXX)"
head -c ${socket.nodeGzipBytes} | gzip -d > "$directory/node"
chmod 700 "$directory/node"
test "$(sha256sum "$directory/node" | cut -d ' ' -f 1)" = "${socket.nodeSha256}"
test "$("$directory/node" --version)" = "v22.23.2"
IFS= read -r bundle
printf '%s' "$bundle" | base64 -d > "$directory/operator.cjs"
unset bundle
test "$(sha256sum "$directory/operator.cjs" | cut -d ' ' -f 1)" = "${payloadSha256}"
exec "$directory/node" "$directory/operator.cjs"`;
    return ['/home/yan/.railway/bin/railway','ssh','--project',TARGET.projectId,'--environment',TARGET.environmentId,'--service',TARGET.mysqlServiceId,'--','sh','-c',script];
  }
  const script = `set -eu
test "$RAILWAY_PROJECT_ID" = "${TARGET.projectId}"
test "$RAILWAY_ENVIRONMENT_ID" = "${TARGET.environmentId}"
test "$RAILWAY_SERVICE_ID" = "${TARGET.serviceId}"
test "$RAILWAY_DEPLOYMENT_ID" = "${identity.deploymentId}"
test "$STAGING_MAINTENANCE_MODE" = "true"
umask 077
directory="$(mktemp -d /tmp/l4ckos-operator.XXXXXXXX)"
IFS= read -r L4CKOS_OPERATOR_DATABASE_URL
export L4CKOS_OPERATOR_DATABASE_URL
IFS= read -r bundle
printf '%s' "$bundle" | base64 -d > "$directory/operator.cjs"
unset bundle
test "$(sha256sum "$directory/operator.cjs" | cut -d ' ' -f 1)" = "${payloadSha256}"
cd /app
export NODE_PATH=/app/node_modules
exec node "$directory/operator.cjs"`;
  return ['/home/yan/.railway/bin/railway', 'ssh', '--project', TARGET.projectId,
    '--environment', TARGET.environmentId, '--service', TARGET.serviceId,
    '--', 'sh', '-c', script];
}
