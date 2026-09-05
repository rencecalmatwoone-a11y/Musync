import { readdir, readFile, access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const generatedModules = new Set([
  resolve(root, 'src/spotify/config.js'),
  resolve(root, 'src/supabase/config.js'),
])

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? collect(path) : /\.m?js$/.test(entry.name) ? [path] : []
  }))
  return files.flat()
}

const files = [join(root, 'server.js'), ...(await Promise.all(
  ['api', 'src', 'server', 'scripts'].map((directory) => collect(join(root, directory))),
)).flat()]

for (const file of files) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' })
  const source = await readFile(file, 'utf8')
  const imports = source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.[^"']+)["']/g)
  for (const [, specifier] of imports) {
    const target = resolve(dirname(file), specifier.split(/[?#]/)[0])
    if (!generatedModules.has(target)) await access(target)
  }
}

console.log(`Syntax and relative import checks passed for ${files.length} JavaScript files.`)
