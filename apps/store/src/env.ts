export interface Env {
  /** The `gamebox-bundles` R2 bucket. */
  BUNDLES: R2Bucket;
  /** Secret: the bearer token `POST /bundles` must carry. With none set, uploads are off. */
  STORE_PUBLISH_TOKEN?: string;
}
