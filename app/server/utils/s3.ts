import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export interface S3Config {
  region: string
  endpoint?: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

export function getS3Config(): S3Config | null {
  const cfg = useRuntimeConfig()
  if (!cfg.s3Region || !cfg.s3Bucket || !cfg.s3AccessKeyId || !cfg.s3SecretAccessKey) return null
  return {
    region: cfg.s3Region as string,
    endpoint: (cfg.s3Endpoint as string) || undefined,
    bucket: cfg.s3Bucket as string,
    accessKeyId: cfg.s3AccessKeyId as string,
    secretAccessKey: cfg.s3SecretAccessKey as string,
  }
}

function makeClient(cfg: S3Config): S3Client {
  return new S3Client({
    region: cfg.region,
    ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    // forcePathStyle required for MinIO, Cloudflare R2, and most S3-compatible services
    forcePathStyle: !!cfg.endpoint,
  })
}

export async function presignedPutUrl(key: string, expiresIn = 3600): Promise<string> {
  const cfg = getS3Config()
  if (!cfg) throw new Error('S3 not configured')
  const command = new PutObjectCommand({ Bucket: cfg.bucket, Key: key, ContentType: 'application/octet-stream' })
  return getSignedUrl(makeClient(cfg), command, { expiresIn })
}

export async function presignedGetUrl(key: string, expiresIn = 3600): Promise<string> {
  const cfg = getS3Config()
  if (!cfg) throw new Error('S3 not configured')
  const command = new GetObjectCommand({ Bucket: cfg.bucket, Key: key })
  return getSignedUrl(makeClient(cfg), command, { expiresIn })
}
