/**
 * Перенос персональных файлов (вложения чатов, файлы заявок на подбор) из публичного bucket в S3_PRIVATE_BUCKET.
 * Ссылки в БД не меняются: ключ объекта тот же, API читает сначала приватный bucket, затем публичный.
 *
 * Запуск из каталога backend (по умолчанию — только отчёт):
 *   npm run storage:migrate-private
 *   npm run storage:migrate-private -- --apply
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { isPrivateObjectKey, PRIVATE_OBJECT_LIST_PREFIXES } from '../src/modules/storage/private-objects';

function tryLoadEnvFile(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

tryLoadEnvFile(resolve(__dirname, '../.env'));
tryLoadEnvFile(resolve(process.cwd(), '.env'));

function env(name: string, fallback?: string): string {
  const v = process.env[name]?.trim() || (fallback ? process.env[fallback]?.trim() : undefined);
  if (!v) throw new Error(`Не задан ${name}`);
  return v;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const publicBucket = env('S3_BUCKET');
  const privateBucket = env('S3_PRIVATE_BUCKET');
  if (publicBucket === privateBucket) throw new Error('S3_PRIVATE_BUCKET должен отличаться от S3_BUCKET');

  const forcePath = ['1', 'true'].includes(process.env.S3_FORCE_PATH_STYLE?.trim() ?? '');
  const s3 = new S3Client({
    region: process.env.S3_REGION?.trim() || 'ru-central1',
    endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
    credentials: {
      accessKeyId: env('S3_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID'),
      secretAccessKey: env('S3_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY'),
    },
    forcePathStyle: forcePath,
  });

  let found = 0;
  let moved = 0;
  for (const prefix of PRIVATE_OBJECT_LIST_PREFIXES) {
    let token: string | undefined;
    do {
      const page = await s3.send(
        new ListObjectsV2Command({ Bucket: publicBucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const obj of page.Contents ?? []) {
        const key = obj.Key;
        if (!key || key.endsWith('/') || !isPrivateObjectKey(key)) continue;
        found++;
        if (!apply) {
          console.log(`[dry-run] ${key}`);
          continue;
        }
        await s3.send(
          new CopyObjectCommand({
            Bucket: privateBucket,
            Key: key,
            CopySource: `${publicBucket}/${key.split('/').map(encodeURIComponent).join('/')}`,
          }),
        );
        await s3.send(new DeleteObjectCommand({ Bucket: publicBucket, Key: key }));
        moved++;
        console.log(`moved ${key}`);
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }

  console.log(
    apply
      ? `Готово: перенесено ${moved} из ${found}`
      : `Найдено ${found} объектов. Для переноса запустите с --apply`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
