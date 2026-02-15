#!/usr/bin/env node
/**
 * Captures ~15 seconds of each agent POV viewer as mp4.
 * Requires: puppeteer, ffmpeg
 *
 * Usage: node scripts/capture-povs.mjs
 */

import puppeteer from 'puppeteer'
import { mkdir } from 'fs/promises'
import { execSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(__dirname, '..', 'public', 'povs')

const AGENTS = [
  { name: 'claudecode', port: 4001 },
  { name: 'obsidianwren', port: 4004 },
  { name: 'novablaze', port: 4007 },
]

const DURATION_MS = 15_000
const WIDTH = 640
const HEIGHT = 360
const FPS = 15

async function captureAgent({ name, port }) {
  const url = `http://minecraft.opalbot.gg:${port}/`
  const framesDir = path.join(OUT_DIR, `_frames_${name}`)
  const outFile = path.join(OUT_DIR, `${name}.mp4`)

  await mkdir(framesDir, { recursive: true })

  console.log(`[${name}] opening ${url}...`)
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: WIDTH, height: HEIGHT },
  })

  const page = await browser.newPage()

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20_000 })
  } catch {
    console.log(`[${name}] page load timed out, continuing anyway...`)
  }

  // wait a moment for the viewer to initialize
  await new Promise(r => setTimeout(r, 2000))

  const totalFrames = Math.ceil((DURATION_MS / 1000) * FPS)
  const interval = 1000 / FPS

  console.log(`[${name}] capturing ${totalFrames} frames...`)
  for (let i = 0; i < totalFrames; i++) {
    const framePath = path.join(framesDir, `frame_${String(i).padStart(5, '0')}.png`)
    await page.screenshot({ path: framePath, type: 'png' })
    await new Promise(r => setTimeout(r, interval))
  }

  await browser.close()

  // stitch frames into mp4 with ffmpeg
  console.log(`[${name}] encoding mp4...`)
  const ffmpegCmd = [
    'ffmpeg -y',
    `-framerate ${FPS}`,
    `-i "${framesDir}/frame_%05d.png"`,
    '-c:v libx264',
    '-pix_fmt yuv420p',
    '-preset fast',
    '-crf 23',
    `-s ${WIDTH}x${HEIGHT}`,
    `"${outFile}"`,
  ].join(' ')

  execSync(ffmpegCmd, { stdio: 'inherit' })

  // cleanup frames
  execSync(`rm -rf "${framesDir}"`)
  console.log(`[${name}] done -> ${outFile}`)
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  for (const agent of AGENTS) {
    try {
      await captureAgent(agent)
    } catch (err) {
      console.error(`[${agent.name}] failed:`, err.message)
    }
  }

  console.log('\nAll captures complete!')
}

main()
