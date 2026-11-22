import multer from 'multer';
import yauzl from 'yauzl';
import { fileTypeFromBuffer } from 'file-type';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, extname, join } from 'node:path';
import { assert, privatePage, uuid, value } from './common.mjs';
import { one } from './db.mjs';

const MB = 1024 * 1024;
const accepted = new Set(['image/jpeg','image/png','image/webp','application/pdf','video/mp4']);
const zipTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg'
};
export const mediaUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 35 * MB, files: 1, fields: 8, fieldSize: 8000 } }).single('file');
export const archiveUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 45 * MB, files: 1, fields: 4, fieldSize: 2000 } }).single('file');

export function mediaStore(config) {
  const root = config.storageDir;
  const location = (id) => join(root, uuid(id));
  return {
    prepare: () => mkdir(root, { mode: 0o700, recursive: true }),
    put: (id, bytes) => writeFile(location(id), bytes, { mode: 0o600, flag: 'wx' }),
    remove: async (id) => {
      try { await unlink(location(id)); }
      catch (err) { if (err.code !== 'ENOENT') throw err; }
    },
    get: (id) => location(id)
  };
}

export async function storeCustomerFile(tx, storage, project, file, category, actor, messageId = null, cleanup = []) {
  assert(file?.size > 0, 400, 'Sélectionnez un fichier à importer.');
  const type = (await fileTypeFromBuffer(file.buffer).catch(() => null))?.mime;
  assert(accepted.has(type), 400, 'Choisissez un fichier JPG, PNG, WebP, PDF ou MP4.');
  assert(!['couple','portraits','photos'].includes(category) || type.startsWith('image/'), 400, 'Cette catégorie est réservée aux photographies.');
  assert(category !== 'videos' || type === 'video/mp4', 400, 'Sélectionnez une vidéo MP4.');
  assert(file.size <= (type === 'video/mp4' ? 35 : 12) * MB, 400, 'Le fichier dépasse 12 Mo pour une image ou un PDF, ou 35 Mo pour une vidéo.');
  const stats = await one(tx, 'select count(*)::int as count,coalesce(sum(size),0) as bytes from files where project_id=$1', [project.id]);
  assert(stats.count < 100 && Number(stats.bytes) + file.size <= 250 * MB, 409, 'Ce projet a atteint sa limite de stockage.');
  const name = value(basename(Buffer.from(file.originalname, 'latin1').toString('utf8')), 180, true);
  const row = await one(tx, `insert into files (project_id,uploaded_by,message_id,name,category,media_type,size,confirmed_at)
    values ($1,$2,$3,$4,$5,$6,$7,case when $3::uuid is not null then now() end) returning *`,
    [project.id,actor.id,messageId,name,category,type,file.size]);
  cleanup.push(row.id);
  await storage.put(row.id, file.buffer);
  return row;
}

export function sendPrivateFile(res, store, row) {
  privatePage(res);
  res.set('Content-Security-Policy', "default-src 'none'; sandbox");
  return new Promise((resolve, reject) => res.download(store.get(row.id), row.name, { headers: { 'Content-Type': row.media_type }, acceptRanges: true },
    (error) => error ? reject(error) : resolve()));
}

export async function deployArchive(tx, storage, projectId, label, file, cleanup) {
  assert(file?.size, 400, 'Sélectionnez un dossier de création compressé au format ZIP.');
  let archive;
  try { archive = await yauzl.fromBufferPromise(file.buffer, { strictFileNames: true, validateEntrySizes: true }); }
  catch { assert(false, 400, 'Le fichier ZIP est illisible.'); }
  const version = await one(tx, 'insert into versions (project_id,label) values ($1,$2) returning *', [projectId,label]);
  let total = 0;
  let count = 0;
  const paths = new Set();
  try {
    for await (const entry of archive.eachEntry()) {
      const path = entry.fileName;
      if (path.endsWith('/')) continue;
      const type = zipTypes[extname(path).toLowerCase()];
      assert(path.length < 240 && /^(?:[\w-][\w.-]*\/)*[\w-][\w.-]*$/.test(path) && !paths.has(path) && type,
        400, 'Le ZIP doit contenir des fichiers web aux noms simples. Supprimez les fichiers système et les doublons.');
      count++;
      total += entry.uncompressedSize;
      assert(count <= 140 && entry.uncompressedSize <= 35 * MB && total <= 100 * MB, 413, 'Cette création dépasse la limite de fichiers ou de taille.');
      const chunks = [];
      let size = 0;
      const stream = await archive.openReadStreamPromise(entry);
      for await (const chunk of stream) {
        size += chunk.length;
        assert(size <= entry.uncompressedSize, 400, 'La taille d’un fichier du ZIP est invalide.');
        chunks.push(chunk);
      }
      const key = randomUUID();
      cleanup.push(key);
      const bytes=Buffer.concat(chunks,size);
      const detected=type.startsWith('image/')?(await fileTypeFromBuffer(bytes).catch(()=>null))?.mime:null;
      const imageType=detected?.startsWith('image/')?detected:type;
      await storage.put(key, bytes);
      await tx.query('insert into version_assets (version_id,path,storage_key,media_type) values ($1,$2,$3,$4)', [version.id,path,key,imageType]);
      paths.add(path);
    }
  } finally {
    archive.close();
  }
  assert(paths.has('index.html'), 400, 'Ajoutez index.html à la racine du fichier ZIP.');
  return version;
}
