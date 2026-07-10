// Split a stored blob/object URL into { container, key } and refuse any URL that
// does not point at our own storage account. The host check is the SSRF guard:
// without it, a caller could make the service fetch arbitrary URLs from inside
// the cluster.

function azureActive(): boolean {
  return !!(
    process.env.AZURE_STORAGE_ACCOUNT &&
    process.env.AZURE_STORAGE_KEY &&
    process.env.AZURE_STORAGE_CONTAINER
  )
}

// The host we accept, derived from the active backend's configuration.
function expectedHost(): string {
  if (azureActive()) {
    const ep = process.env.AZURE_STORAGE_ENDPOINT
    if (ep) return new URL(ep).host
    return `${process.env.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net`
  }
  return `${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com`
}

export function parseStorageUrl(url: string): { container: string; key: string } {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new Error('bad-url')
  }

  if (u.host !== expectedHost()) throw new Error('foreign-host')

  // Path is /<first>/<rest>. For Azure the first segment may be the account name
  // (when an endpoint override includes it, e.g. Azurite's devstoreaccount1); in
  // that case the container is the SECOND segment. We normalize by stripping a
  // leading segment that matches the configured account path from the endpoint.
  let path = u.pathname.replace(/^\/+/, '')

  if (azureActive()) {
    if (process.env.AZURE_STORAGE_ENDPOINT) {
      const epPath = new URL(process.env.AZURE_STORAGE_ENDPOINT).pathname.replace(/^\/+|\/+$/g, '')
      if (epPath && path.startsWith(epPath + '/')) path = path.slice(epPath.length + 1)
    }

    const slash = path.indexOf('/')
    if (slash <= 0 || slash === path.length - 1) throw new Error('bad-url')

    return { container: path.slice(0, slash), key: path.slice(slash + 1) }
  }

  // S3 virtual-hosted-style URLs carry the bucket in the host, not the path, so
  // the entire path is the key and the container is the configured bucket.
  if (!path) throw new Error('bad-url')

  return { container: process.env.AWS_S3_BUCKET as string, key: path }
}
