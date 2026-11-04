// bright-text —— 「设置 → 字体颜色修改」：文字颜色 / 字号 / 字体
//
// 颜色：色相（0-360）、饱和度、深色/浅色主题各自的亮度。
// 字号：12–22px（或跟随宿主）。
// 字体：系统已装的楷体/行楷/隶书/仿宋…，四款开源书法字体（首次选用时下载并缓存），
//       以及用户自己导入的字体文件（存 IndexedDB，重启还在）。
//
// 着色策略（0.2.0 起）：宿主 ThemePresenter 把整套主题 token 以「内联普通声明」写到 body，
// 只往 head 塞一条样式表并不可靠。现在三层同时上：
//   1) html 与 body 上直接内联写 !important；
//   2) 注入 <style id="dsh-bright-text"> 兜底；
//   3) MutationObserver + 1.2s 定时自检，被改写就补回去。
// 关键：applyAll(cfg) 必须同步 state.cfg，否则守护会用旧配置把新颜色覆盖回去。
//
// 主题判定不依赖宿主把 data-ds-dark-theme 挂在哪个元素上，插件自己在 <html> 打
// data-btx-dark / data-btx-light，CSS 同时覆盖 html 和 body。
//
// 字体相关的宿主变量（0.3.0 新增）：
//   --dsh-content-font-size / --dsh-content-font-size-secondary  正文与次要文字字号
//   --dsh-content-font-delta / --dsh-content-font-delta-secondary  行高补偿
//   --dsh-font-family-text  → 宿主的 --dsw-font-family 由它派生
// 只改正文，不碰代码块 / 终端（--dsh-font-family-code、--dsh-code-font-size 保持原样）。

window.__ModuleLoader__.load({
  id: '@local/bright-text',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useRef } = React
    const h = React.createElement

    const STORAGE_KEY = 'dsh.bright-text.config'
    const FONTS_META_KEY = 'dsh.bright-text.fonts'
    const CONFIG_VERSION = 4
    const DEFAULTS = {
      hue: 220, sat: 0, darkLight: 92, lightLight: 10,
      fontSize: 0,          // 0 = 跟随宿主
      fontId: 'default',    // 'default' | 预设 id | 'custom:<id>'
    }

    const FALLBACK_STACK = '"PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", "Noto Sans SC", sans-serif'

    // 文字变量 -> 相对主色的不透明度
    const LEVELS = [
      ['--dsw-alias-label-primary', 1],
      ['--dsw-alias-label-primary-dimmed', 0.88],
      ['--dsw-alias-label-secondary', 0.78],
      ['--dsw-alias-label-tertiary', 0.64],
      ['--dsw-alias-label-caption', 0.56],
      ['--dsw-alias-label-dimmed', 0.48],
    ]

    // 一键配色：只改色相和饱和度，亮度各自保留
    const PRESETS = [
      ['白', 0, 0],
      ['暖白', 42, 28],
      ['青', 184, 62],
      ['绿', 142, 52],
      ['蓝', 218, 58],
      ['紫', 276, 52],
      ['粉', 336, 52],
      ['黄', 48, 62],
    ]

    // 系统字体：直接用已装字体名，零下载
    const SYSTEM_FONTS = [
      { id: 'sys-kaiti', label: '楷体', stack: '"Kaiti SC", "KaiTi", 楷体, "STKaiti", serif' },
      { id: 'sys-xingkai', label: '行楷', stack: '"STXingkai", "Xingkai SC", "华文行楷", "STKaiti", cursive, serif' },
      { id: 'sys-lishu', label: '隶书', stack: '"LiSu", "STLiti", 隶书, "Kaiti SC", serif' },
      { id: 'sys-fangsong', label: '仿宋', stack: '"FangSong", "STFangsong", 仿宋, "Songti SC", serif' },
      { id: 'sys-song', label: '宋体', stack: '"Songti SC", "SimSun", 宋体, "STSong", serif' },
      { id: 'sys-hei', label: '黑体', stack: '"Heiti SC", "SimHei", 黑体, "PingFang SC", sans-serif' },
      { id: 'sys-yahei', label: '雅黑', stack: '"Microsoft YaHei", 微软雅黑, "PingFang SC", sans-serif' },
      { id: 'sys-round', label: '幼圆', stack: '"YouYuan", 幼圆, "Yuanti SC", "Microsoft YaHei", sans-serif' },
    ]

    // 开源书法字体：全部 SIL Open Font License，可自由使用 / 再分发。
    // 首次选用时从 jsDelivr 下载 TTF（2.6–3.6 MB），存进 IndexedDB，之后离线可用。
    const WEB_FONTS = [
      {
        id: 'web-mashan', label: '马善政楷书', family: 'BTX Ma Shan Zheng',
        note: '毛笔楷书 · OFL', size: '3.6 MB',
        url: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/mashanzheng/MaShanZheng-Regular.ttf',
      },
      {
        id: 'web-zhimang', label: '志莽行书', family: 'BTX Zhi Mang Xing',
        note: '行书 · OFL', size: '2.6 MB',
        url: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/zhimangxing/ZhiMangXing-Regular.ttf',
      },
      {
        id: 'web-longcang', label: '龙藏体', family: 'BTX Long Cang',
        note: '行草 · OFL', size: '3.3 MB',
        url: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/longcang/LongCang-Regular.ttf',
      },
      {
        id: 'web-maocao', label: '刘建毛草', family: 'BTX Liu Jian Mao Cao',
        note: '草书 · OFL', size: '2.6 MB',
        url: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/liujianmaocao/LiuJianMaoCao-Regular.ttf',
      },
    ]

    const ALL_PRESET_FONTS = [{ id: 'default', label: '默认' }].concat(SYSTEM_FONTS, WEB_FONTS)

    function presetById(id) {
      for (const item of ALL_PRESET_FONTS) if (item.id === id) return item
      for (const item of WEB_FONTS) if (item.id === id) return item
      return null
    }

    const STYLES = `
.btx-wrap { padding-top: 18px; }
.btx-title { margin: 0; font-size: 16px; line-height: 24px; font-weight: 600; }
.btx-desc { margin: 6px 0 4px; font-size: 12.5px; line-height: 19px; color: var(--dsw-alias-label-secondary); }
.btx-diag { margin: 0 0 2px; font-size: 11.5px; line-height: 17px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.btx-row { padding: 14px 0; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.btx-rowhead { display: flex; align-items: center; gap: 8px; }
.btx-label { font-size: 14px; line-height: 20px; }
.btx-value { margin-left: auto; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.btx-badge { flex: none; font-size: 11px; line-height: 16px; padding: 0 7px; border-radius: 999px; color: var(--dsw-alias-brand-primary); border: 1px solid currentColor; }
.btx-warn { margin: 8px 0 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary, #ff7a45); }
.btx-swatch { width: 16px; height: 16px; border-radius: 5px; border: 1px solid var(--dsw-alias-border-l1); flex: none; }
.btx-range { appearance: none; -webkit-appearance: none; width: 100%; height: 22px; margin: 8px 0 0; background: transparent; cursor: pointer; }
.btx-range::-webkit-slider-runnable-track { height: 6px; border-radius: 999px; background: var(--btx-track, var(--dsw-alias-bg-layer-3)); }
.btx-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 16px; height: 16px; margin-top: -5px; border-radius: 50%; background: #fff; border: 1px solid rgba(0,0,0,.22); box-shadow: 0 1px 3px rgba(0,0,0,.28); }
.btx-range:focus-visible::-webkit-slider-thumb { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.btx-presets { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.btx-preset { appearance: none; cursor: pointer; font: inherit; font-size: 12px; line-height: 18px; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); display: inline-flex; align-items: center; gap: 6px; }
.btx-preset:hover { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
.btx-dot { width: 10px; height: 10px; border-radius: 50%; border: 1px solid rgba(0,0,0,.18); flex: none; }
.btx-subhead { margin: 22px 0 0; font-size: 14px; line-height: 20px; }
.btx-preview { display: flex; gap: 12px; margin-top: 10px; }
.btx-pv { flex: 1; min-width: 0; border-radius: 10px; padding: 12px 14px; border: 1px solid var(--dsw-alias-border-l1); }
.btx-pv-title { font-size: 11px; line-height: 16px; letter-spacing: .06em; opacity: .55; margin-bottom: 6px; }
.btx-pv-text { line-height: 1.5; }
.btx-pv-sub { line-height: 1.45; }
.btx-actions { display: flex; align-items: center; gap: 10px; margin-top: 18px; }
.btx-btn { appearance: none; cursor: pointer; font: inherit; font-size: 12.5px; padding: 5px 14px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.btx-btn:hover { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
.btx-btn[disabled] { opacity: .55; cursor: default; }
.btx-hint { margin-left: auto; font-size: 11.5px; line-height: 17px; color: var(--dsw-alias-label-secondary); }
.btx-fonts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
.btx-font { appearance: none; cursor: pointer; text-align: left; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); overflow: hidden; }
.btx-font:hover { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
.btx-font.is-active { border-color: var(--dsw-alias-brand-primary); }
.btx-font-name { display: block; font-size: 12px; line-height: 17px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.btx-font-samp { display: block; font-size: 17px; line-height: 24px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.btx-font-note { display: block; font-size: 10.5px; line-height: 15px; color: var(--dsw-alias-label-tertiary); margin-top: 1px; }
.btx-file { display: none; }
.btx-status { margin: 8px 0 0; font-size: 11.5px; line-height: 17px; color: var(--dsw-alias-label-secondary); }
.btx-status.is-err { color: var(--dsw-alias-state-error-primary, #ff7a45); }
`

    function clamp(value, lo, hi) {
      const n = Number(value)
      if (!Number.isFinite(n)) return lo
      return Math.min(hi, Math.max(lo, n))
    }

    function normalize(raw) {
      const source = raw && typeof raw === 'object' ? raw : {}
      return {
        hue: clamp(source.hue === undefined ? DEFAULTS.hue : source.hue, 0, 360),
        sat: clamp(source.sat === undefined ? DEFAULTS.sat : source.sat, 0, 100),
        darkLight: clamp(source.darkLight === undefined ? DEFAULTS.darkLight : source.darkLight, 0, 100),
        lightLight: clamp(source.lightLight === undefined ? DEFAULTS.lightLight : source.lightLight, 0, 100),
        fontSize: clamp(source.fontSize === undefined ? DEFAULTS.fontSize : source.fontSize, 0, 24),
        fontId: typeof source.fontId === 'string' && source.fontId ? source.fontId : DEFAULTS.fontId,
      }
    }

    function loadConfig() {
      let raw = null
      try {
        raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null')
      } catch (err) {
        raw = null
      }
      const cfg = normalize(raw)
      // 旧版存过「亮度贴边」的值（100 / 6）：那两档就是纯白 / 纯黑，色相和饱和度怎么调都看不出来，
      // 用户会以为插件坏了。迁移到两端都还能看出颜色的区间。
      if (!raw || raw.version !== CONFIG_VERSION) {
        if (cfg.darkLight >= 96) cfg.darkLight = 82
        if (cfg.lightLight >= 96) cfg.lightLight = 82
        if (cfg.darkLight <= 8) cfg.darkLight = 18
        if (cfg.lightLight <= 8) cfg.lightLight = 18
      }
      return cfg
    }

    function saveConfig(cfg) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
          hue: cfg.hue,
          sat: cfg.sat,
          darkLight: cfg.darkLight,
          lightLight: cfg.lightLight,
          fontSize: cfg.fontSize,
          fontId: cfg.fontId,
          version: CONFIG_VERSION,
        }))
      } catch (err) {
        // 隐私模式禁用 localStorage 时只是不持久化，不影响本次生效
      }
    }

    function hslToRgb(hue, sat, light) {
      const s = sat / 100
      const l = light / 100
      const c = (1 - Math.abs(2 * l - 1)) * s
      const hp = ((hue % 360) + 360) % 360 / 60
      const x = c * (1 - Math.abs((hp % 2) - 1))
      let r = 0
      let g = 0
      let b = 0
      if (hp < 1) { r = c; g = x; b = 0 }
      else if (hp < 2) { r = x; g = c; b = 0 }
      else if (hp < 3) { r = 0; g = c; b = x }
      else if (hp < 4) { r = 0; g = x; b = c }
      else if (hp < 5) { r = x; g = 0; b = c }
      else { r = c; g = 0; b = x }
      const m = l - c / 2
      return [
        Math.round((r + m) * 255),
        Math.round((g + m) * 255),
        Math.round((b + m) * 255),
      ]
    }

    function rgba(rgb, alpha) {
      if (alpha >= 1) return 'rgb(' + rgb[0] + ', ' + rgb[1] + ', ' + rgb[2] + ')'
      return 'rgba(' + rgb[0] + ', ' + rgb[1] + ', ' + rgb[2] + ', ' + alpha + ')'
    }

    function hexOf(rgb) {
      return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('')
    }

    // ---------- 主题判定 ----------

    // 宿主的深色标记挂在哪不固定；依次看 body/html 属性、inline color-scheme、来源、系统偏好
    function schemeOf(doc) {
      if (!doc) return 'light'
      const html = doc.documentElement
      const body = doc.body
      if (body && body.hasAttribute && body.hasAttribute('data-ds-dark-theme')) return 'dark'
      if (html && html.hasAttribute && html.hasAttribute('data-ds-dark-theme')) return 'dark'
      if (html && html.style) {
        const inline = html.style.colorScheme
        if (inline === 'dark' || inline === 'light') return inline
      }
      if (html && html.getAttribute) {
        const source = html.getAttribute('data-ds-theme-source')
        if (source === 'dark' || source === 'light') return source
      }
      try {
        const view = doc.defaultView
        if (view && view.matchMedia && view.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
      } catch (err) {
        // 拿不到 matchMedia 就当浅色
      }
      return 'light'
    }

    function rgbFor(cfg, scheme) {
      return hslToRgb(cfg.hue, cfg.sat, scheme === 'dark' ? cfg.darkLight : cfg.lightLight)
    }

    // ---------- 字体 ----------

    // 宿主的正文字号（我们动手之前量一次），用来换算行高补偿。
    // 量到的值存一份到 localStorage：热重载时 DOM 里已经有我们写过的值，再量就量错了。
    let baseFontSize = 14
    let baseMeasured = false
    const BASE_SIZE_KEY = 'dsh.bright-text.base'

    function measureBaseFontSize(doc) {
      if (baseMeasured) return
      baseMeasured = true
      try {
        const saved = parseFloat(window.localStorage.getItem(BASE_SIZE_KEY) || '')
        if (Number.isFinite(saved) && saved > 8 && saved < 40) {
          baseFontSize = saved
          return
        }
      } catch (err) {
        // localStorage 不可用就现量
      }
      try {
        const el = doc.body || doc.documentElement
        const value = parseFloat(doc.defaultView.getComputedStyle(el).getPropertyValue('--dsh-content-font-size'))
        if (Number.isFinite(value) && value > 8 && value < 40) {
          baseFontSize = value
          try { window.localStorage.setItem(BASE_SIZE_KEY, String(value)) } catch (err) { /* 忽略 */ }
        }
      } catch (err) {
        // 量不到就用默认 14
      }
    }

    function customFamilyOf(id) {
      return 'BTX ' + String(id).replace(/^custom:/, '').replace(/[^a-zA-Z0-9_-]/g, '')
    }

    // 返回给 --dsh-font-family-text 的字体栈；null 表示不干预
    function fontFamilyFor(cfg) {
      if (!cfg.fontId || cfg.fontId === 'default') return null
      const preset = presetById(cfg.fontId)
      if (preset && preset.stack) return preset.stack
      if (preset && preset.family) return '"' + preset.family + '", ' + FALLBACK_STACK
      if (cfg.fontId.indexOf('custom:') === 0) return '"' + customFamilyOf(cfg.fontId) + '", ' + FALLBACK_STACK
      return null
    }

    function fontVars(cfg) {
      const out = []
      if (cfg.fontSize > 0) {
        const size = Math.round(cfg.fontSize)
        const delta = size - Math.round(baseFontSize)
        const secondary = Math.max(10, size - 1)
        out.push(['--dsh-content-font-size', size + 'px'])
        out.push(['--dsh-content-font-delta', delta + 'px'])
        out.push(['--dsh-content-font-size-secondary', secondary + 'px'])
        out.push(['--dsh-content-font-delta-secondary', (secondary - Math.max(10, Math.round(baseFontSize) - 1)) + 'px'])
      }
      const family = fontFamilyFor(cfg)
      if (family) {
        out.push(['--dsh-font-family-text', family])
        out.push(['--dsw-font-family', family])
      }
      return out
    }

    // ---------- 本地字体库（IndexedDB） ----------

    const DB_NAME = 'dsh-bright-text'
    const DB_STORE = 'fonts'

    function openDb() {
      return new Promise((resolve, reject) => {
        if (!window.indexedDB) { reject(new Error('浏览器不支持 IndexedDB')); return }
        const req = window.indexedDB.open(DB_NAME, 1)
        req.onupgradeneeded = () => {
          const db = req.result
          if (db && !db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE)
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error || new Error('IndexedDB 打不开'))
      })
    }

    function dbRequest(mode, run) {
      return openDb().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, mode)
        const store = tx.objectStore(DB_STORE)
        const req = run(store)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error || new Error('IndexedDB 读写失败'))
      }))
    }

    const dbGet = (key) => dbRequest('readonly', (s) => s.get(key))
    const dbPut = (key, value) => dbRequest('readwrite', (s) => s.put(value, key))
    const dbDel = (key) => dbRequest('readwrite', (s) => s.delete(key))

    // 导入字体的人类可读名字存在 localStorage（二进制在 IndexedDB）
    function loadFontMeta() {
      try {
        const raw = JSON.parse(window.localStorage.getItem(FONTS_META_KEY) || '[]')
        return Array.isArray(raw) ? raw.filter((item) => item && typeof item.id === 'string') : []
      } catch (err) {
        return []
      }
    }

    function saveFontMeta(list) {
      try {
        window.localStorage.setItem(FONTS_META_KEY, JSON.stringify(list))
      } catch (err) {
        // 存不下就只是重启后丢名字，不影响本次使用
      }
    }

    const loadedFaces = {}

    function ensureFace(family, buffer) {
      if (loadedFaces[family]) return Promise.resolve(family)
      if (typeof window.FontFace !== 'function') return Promise.reject(new Error('浏览器不支持 FontFace'))
      const face = new window.FontFace(family, buffer, { display: 'swap' })
      return face.load().then(() => {
        document.fonts.add(face)
        loadedFaces[family] = face
        return family
      })
    }

    // 同一个字体的加载只做一次：颜色滑块每动一下都会触发 apply，不能每次都重新下载
    const fontPromises = {}

    // 预设里的开源字体 + 用户导入的字体，都走这里
    function ensureFontLoaded(fontId) {
      if (!fontId || fontId === 'default') return Promise.resolve(null)
      const preset = presetById(fontId)
      if (preset && preset.stack) return Promise.resolve(null)          // 系统字体，不用加载
      if (fontPromises[fontId]) return fontPromises[fontId]
      const promise = loadFontImpl(fontId, preset)
      fontPromises[fontId] = promise
      // 失败不缓存，下次还能重试
      promise.catch(() => { delete fontPromises[fontId] })
      return promise
    }

    function loadFontImpl(fontId, preset) {
      if (preset && preset.family) {
        if (loadedFaces[preset.family]) return Promise.resolve(preset.family)
        const key = 'web:' + preset.id
        return dbGet(key).then((cached) => {
          if (cached) return ensureFace(preset.family, cached)
          return fetch(preset.url, { mode: 'cors' })
            .then((res) => {
              if (!res.ok) throw new Error('下载失败：HTTP ' + res.status)
              return res.arrayBuffer()
            })
            .then((buffer) => dbPut(key, buffer).then(() => ensureFace(preset.family, buffer)))
        })
      }
      if (fontId.indexOf('custom:') === 0) {
        const family = customFamilyOf(fontId)
        if (loadedFaces[family]) return Promise.resolve(family)
        return dbGet(fontId).then((record) => {
          if (!record || !record.buffer) throw new Error('这个导入字体已被删除')
          return ensureFace(family, record.buffer)
        })
      }
      return Promise.resolve(null)
    }

    // ---------- 三层着色 ----------

    // 宿主的深色标记挂在哪个元素上并不固定（实测：挂在 <html> 上，body 没有），
    // 只写 body[data-ds-dark-theme] 会让 body 继续用浅色那一条 —— 界面就永远不变色。
    // 所以深色一律由插件自己在 <html> 上打 data-btx-dark，并用后代选择器把 body 一起覆盖。
    function cssText(cfg) {
      const block = (rgb) => LEVELS.map(([token, alpha]) => token + ': ' + rgba(rgb, alpha) + ' !important;').join('\n')
      const extra = fontVars(cfg).map(([name, value]) => name + ': ' + value + ' !important;').join('\n')
      const lines = [
        '/* bright-text: 浅色主题 */',
        'html, body {',
        block(hslToRgb(cfg.hue, cfg.sat, cfg.lightLight)),
        '}',
        '/* bright-text: 深色主题（插件判定后打标记，html 和 body 同时覆盖） */',
        'html[data-btx-dark], html[data-btx-dark] body {',
        block(hslToRgb(cfg.hue, cfg.sat, cfg.darkLight)),
        '}',
        '/* 兜底：还没打标记时按系统偏好走 */',
        '@media (prefers-color-scheme: dark) {',
        '  html:not([data-btx-light]) body {',
        block(hslToRgb(cfg.hue, cfg.sat, cfg.darkLight)),
        '  }',
        '}',
      ]
      if (extra) {
        lines.push('/* bright-text: 字号与字体（与主题无关） */')
        lines.push('html, body {')
        lines.push(extra)
        lines.push('}')
      }
      return lines.join('\n')
    }

    // 只在值真的变了才写属性，避免 MutationObserver 自激
    function markScheme(doc, scheme) {
      const html = doc && doc.documentElement
      if (!html || !html.setAttribute) return
      if (scheme === 'dark') {
        if (!html.hasAttribute('data-btx-dark')) html.setAttribute('data-btx-dark', '')
        if (html.hasAttribute('data-btx-light')) html.removeAttribute('data-btx-light')
      } else {
        if (!html.hasAttribute('data-btx-light')) html.setAttribute('data-btx-light', '')
        if (html.hasAttribute('data-btx-dark')) html.removeAttribute('data-btx-dark')
      }
    }

    function ensureStyleTag(doc, cfg) {
      if (!doc || !doc.head) return null
      let tag = doc.getElementById ? doc.getElementById('dsh-bright-text') : null
      if (!tag) {
        tag = doc.createElement('style')
        tag.id = 'dsh-bright-text'
        doc.head.appendChild(tag)
      }
      const text = cssText(cfg)
      if (tag.textContent !== text) tag.textContent = text
      return tag
    }

    // 内联写 !important：同一组值只写一次，避免和 MutationObserver 互相触发；
    // 如果宿主把我们的内联样式抹掉了（值还在缓存里但元素上已经没了），也要补写。
    const inlineSignature = new WeakMap()

    function varsFor(cfg, scheme) {
      const out = LEVELS.map(([token, alpha]) => [token, rgba(rgbFor(cfg, scheme), alpha)])
      return out.concat(fontVars(cfg))
    }

    // 这些变量可能因为「改回默认字体 / 跟随宿主字号」而需要从内联样式里撤掉
    const FONT_VAR_NAMES = [
      '--dsh-content-font-size',
      '--dsh-content-font-delta',
      '--dsh-content-font-size-secondary',
      '--dsh-content-font-delta-secondary',
      '--dsh-font-family-text',
      '--dsw-font-family',
    ]

    // 宿主自己会把这些变量内联写在 body 上。我们覆盖之前先把原值记下来，
    // 撤回时还给它 —— 直接 removeProperty 会把宿主的设置一起删掉（用户会看到字号莫名变回 14px）。
    const originalInline = new WeakMap()

    function writeInline(el, cfg, scheme) {
      if (!el || !el.style || !el.style.setProperty) return
      const vars = varsFor(cfg, scheme)
      const signature = vars.map(([name, value]) => name + '=' + value).join(';')
      if (inlineSignature.get(el) === signature) {
        let intact = true
        for (const [name] of vars) {
          if (el.style.getPropertyValue(name) === '') { intact = false; break }
        }
        if (intact) return
      }
      let saved = originalInline.get(el)
      if (!saved) {
        saved = {}
        originalInline.set(el, saved)
      }
      const active = {}
      for (const [name, value] of vars) {
        active[name] = true
        if (!Object.prototype.hasOwnProperty.call(saved, name)) saved[name] = el.style.getPropertyValue(name)
        try {
          el.style.setProperty(name, value, 'important')
        } catch (err) {
          // 个别老内核不支持内联 important，样式表那层还会兜底
        }
      }
      for (const name of FONT_VAR_NAMES) {
        if (!active[name]) {
          const previous = saved[name]
          try {
            if (previous) el.style.setProperty(name, previous)
            else el.style.removeProperty(name)
          } catch (err) {
            // 忽略
          }
          delete saved[name]
        }
      }
      inlineSignature.set(el, signature)
    }

    function paintDoc(doc, cfg) {
      if (!doc || !doc.documentElement) return null
      measureBaseFontSize(doc)
      const scheme = schemeOf(doc)
      markScheme(doc, scheme)
      ensureStyleTag(doc, cfg)
      writeInline(doc.documentElement, cfg, scheme)
      writeInline(doc.body, cfg, scheme)
      return { scheme }
    }

    // 设置页可能跑在 iframe 里：把父文档一起涂上，主界面才会跟着变
    function relatedDocs() {
      const list = [document]
      for (const key of ['top', 'parent']) {
        try {
          const view = window[key]
          if (view && view !== window && view.document && view.document.documentElement && list.indexOf(view.document) === -1) {
            list.push(view.document)
          }
        } catch (err) {
          // 跨域时跳过
        }
      }
      return list
    }

    // 每次上色都记住这份配置：定时自检 / MutationObserver 补写都得用最新的那份，
    // 否则改完颜色 1.2 秒后会被上一份旧配置覆盖回去（"调了一回又不行了"就是这么来的）。
    function applyAll(cfg) {
      if (cfg) state.cfg = cfg
      const active = cfg || state.cfg
      let info = null
      for (const doc of relatedDocs()) {
        try {
          const painted = paintDoc(doc, active)
          if (doc === document) info = painted
        } catch (err) {
          // 单个文档失败不影响其它文档
        }
      }
      return info
    }

    function readVar(doc, token) {
      try {
        const el = doc.body || doc.documentElement
        const value = doc.defaultView.getComputedStyle(el).getPropertyValue(token)
        return (value || '').trim()
      } catch (err) {
        return ''
      }
    }

    function sameColor(a, b) {
      return String(a || '').replace(/\s+/g, '') === String(b || '').replace(/\s+/g, '')
    }

    // 自检：变量被宿主改写（主题切换、字体设置变更都会重写 body 内联样式）就补回去
    function repair(cfg) {
      for (const doc of relatedDocs()) {
        try {
          const scheme = schemeOf(doc)
          const want = rgba(rgbFor(cfg, scheme), 1)
          let ok = sameColor(readVar(doc, '--dsw-alias-label-primary'), want)
          if (ok && cfg.fontSize > 0) {
            ok = sameColor(readVar(doc, '--dsh-content-font-size'), Math.round(cfg.fontSize) + 'px')
          }
          if (ok) {
            const family = fontFamilyFor(cfg)
            if (family) {
              // 字体栈可能被浏览器规整过，只认第一个族名还在不在
              const head = family.split(',')[0].trim()
              ok = readVar(doc, '--dsh-font-family-text').indexOf(head) >= 0
            }
          }
          if (!ok) paintDoc(doc, cfg)
        } catch (err) {
          // 忽略
        }
      }
    }

    function track(rgb) {
      return 'linear-gradient(90deg, ' + rgba(rgb, 0.12) + ', ' + rgba(rgb, 1) + ')'
    }

    function Row(props) {
      const cfg = props.cfg
      const rgb = props.rgb
      return h('div', { className: 'btx-row' },
        h('div', { className: 'btx-rowhead' },
          props.swatch ? h('span', { className: 'btx-swatch', style: { background: rgba(props.swatch, 1) } }) : null,
          h('label', { className: 'btx-label', htmlFor: props.id }, props.label),
          props.badge ? h('span', { className: 'btx-badge' }, props.badge) : null,
          h('span', { className: 'btx-value' }, props.display)),
        h('input', {
          id: props.id,
          className: 'btx-range',
          type: 'range',
          min: props.min,
          max: props.max,
          step: 1,
          value: cfg[props.field],
          'aria-label': props.label,
          style: { '--btx-track': props.track || track(rgb) },
          onChange: (event) => props.onChange(Number(event.target.value)),
        }))
    }

    function Preview(props) {
      const dark = hslToRgb(props.cfg.hue, props.cfg.sat, props.cfg.darkLight)
      const light = hslToRgb(props.cfg.hue, props.cfg.sat, props.cfg.lightLight)
      const family = fontFamilyFor(props.cfg) || 'inherit'
      const size = props.cfg.fontSize > 0 ? props.cfg.fontSize : baseFontSize
      function panel(bg, rgb, title) {
        return h('div', { className: 'btx-pv', style: { background: bg, fontFamily: family } },
          h('div', { className: 'btx-pv-title', style: { color: rgba(rgb, 0.56) } }, title),
          h('div', { className: 'btx-pv-text', style: { color: rgba(rgb, 1), fontSize: size + 'px' } }, '正文：这是一段示例文字'),
          h('div', { className: 'btx-pv-sub', style: { color: rgba(rgb, 0.78), fontSize: Math.max(11, size - 1) + 'px' } }, '次要说明、时间、工具输出'),
          h('div', { className: 'btx-pv-sub', style: { color: rgba(rgb, 0.56), fontSize: Math.max(11, size - 1) + 'px' } }, '更弱的提示与占位'))
      }
      return h('div', { className: 'btx-preview' },
        panel('#151517', dark, '深色主题'),
        panel('#f5f6f7', light, '浅色主题'))
    }

    // 我们自己会把变量写成目标值，读变量永远是对的 —— 没意义。
    // 只有"页面上第一个可见文字算出来的颜色"才说明到底改没改到界面。
    function probeText(doc) {
      if (!doc || !doc.body) return null
      const view = doc.defaultView
      if (!view || !view.getComputedStyle) return null
      const probes = ['[data-chat-flow] p', '[data-chat-flow] div', 'main p', 'main div', 'button', 'span']
      for (const sel of probes) {
        let nodes
        try { nodes = doc.querySelectorAll(sel) } catch (err) { nodes = [] }
        for (let i = 0; i < nodes.length && i < 80; i++) {
          const el = nodes[i]
          if (el.closest && el.closest('.btx-wrap')) continue
          if (!(el.textContent || '').trim()) continue
          const style = view.getComputedStyle(el)
          if (!style || style.display === 'none' || style.visibility === 'hidden') continue
          const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null
          if (!rect || rect.width < 4 || rect.height < 4) continue
          const cls = (el.className && typeof el.className === 'string') ? el.className.split(/\s+/)[0] : ''
          return {
            color: (style.color || '').trim(),
            where: el.tagName.toLowerCase() + (cls ? '.' + cls.slice(0, 26) : ''),
            sample: (el.textContent || '').trim().slice(0, 14),
          }
        }
      }
      return null
    }

    // 自检行：第一行是环境，第二行是实测的界面文字颜色
    function diagText(cfg) {
      const scheme = schemeOf(document)
      const want = rgba(rgbFor(cfg, scheme), 1)
      const tag = document.getElementById ? document.getElementById('dsh-bright-text') : null
      const html = document.documentElement
      const mark = html && html.hasAttribute('data-btx-dark') ? 'dark'
        : (html && html.hasAttribute('data-btx-light') ? 'light' : '无')
      return '主题 ' + (scheme === 'dark' ? '深色' : '浅色')
        + ' · 目标 ' + want
        + ' · 样式表 ' + (tag ? '已注入' : '未注入')
        + ' · 标记 ' + mark
    }

    function probeLine() {
      const hit = probeText(document)
      return '页面文字 ' + (hit ? hit.color + ' @ ' + hit.where + '「' + hit.sample + '」' : '取不到')
    }

    function TextColorSection() {
      const [cfg, setCfg] = useState(loadConfig)
      const [customs, setCustoms] = useState(loadFontMeta)
      const [status, setStatus] = useState({ text: '', error: false })
      const [busy, setBusy] = useState('')
      const fileRef = useRef(null)

      useEffect(() => {
        applyAll(cfg)
        saveConfig(cfg)
        // 选中的字体可能还没加载完（首次下载 / 从 IndexedDB 恢复）
        ensureFontLoaded(cfg.fontId).then(() => applyAll(cfg)).catch((err) => {
          setStatus({ text: '字体没加载成功：' + (err && err.message ? err.message : err), error: true })
        })
      }, [cfg])

      const update = (patch) => setCfg((prev) => normalize(Object.assign({}, prev, patch)))
      // 拖色相时代码顺手把「看不出颜色」的状态拉回来：饱和度太低提起来，亮度贴边（100% 纯白 / 0% 纯黑）拉回能看出颜色的区间
      const pickHue = (value) => setCfg((prev) => {
        const next = Object.assign({}, prev, { hue: value })
        if (next.sat < 40) next.sat = 70
        if (next.darkLight >= 96) next.darkLight = 82
        if (next.lightLight >= 96) next.lightLight = 82
        if (next.darkLight <= 8) next.darkLight = 18
        if (next.lightLight <= 8) next.lightLight = 18
        return normalize(next)
      })
      const applyPreset = (hue, sat) => setCfg((prev) => {
        const next = Object.assign({}, prev, { hue, sat })
        // 亮度贴边时任何颜色都是纯白/纯黑，先拉回能看出颜色的区间
        if (hue !== 0 || sat !== 0) {
          if (next.darkLight > 92) next.darkLight = 82
          if (next.lightLight > 92) next.lightLight = 82
          if (next.darkLight < 8) next.darkLight = 18
          if (next.lightLight < 8) next.lightLight = 18
        }
        return normalize(next)
      })
      const pickFont = (id) => {
        setCfg((prev) => normalize(Object.assign({}, prev, { fontId: id })))
        const preset = presetById(id)
        if (preset && preset.family) {
          setBusy(id)
          setStatus({ text: '正在准备「' + preset.label + '」…', error: false })
          ensureFontLoaded(id).then(() => {
            setBusy('')
            setStatus({ text: '「' + preset.label + '」已就绪（' + (preset.note || '') + '）', error: false })
            applyAll(state.cfg)
          }).catch((err) => {
            setBusy('')
            setStatus({ text: '「' + preset.label + '」下载失败：' + (err && err.message ? err.message : err), error: true })
          })
        } else {
          setStatus({ text: '', error: false })
        }
      }
      const importFile = (event) => {
        const file = event.target.files && event.target.files[0]
        if (event.target) event.target.value = ''
        if (!file) return
        setBusy('import')
        setStatus({ text: '正在导入「' + file.name + '」…', error: false })
        file.arrayBuffer().then((buffer) => {
          const id = 'custom:' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
          const label = file.name.replace(/\.(ttf|otf|woff2?|ttc)$/i, '')
          // 存本机优先；万一 IndexedDB 用不了（隐私模式 / 存储被禁），也先把字体装上让这次能用
          return dbPut(id, { label: label, buffer: buffer })
            .then(() => ({ id: id, label: label, buffer: buffer, saved: true }))
            .catch(() => ({ id: id, label: label, buffer: buffer, saved: false }))
        }).then((record) => {
          return ensureFace(customFamilyOf(record.id), record.buffer).then(() => {
            if (record.saved) {
              setCustoms((prev) => {
                const next = prev.concat([{ id: record.id, label: record.label }])
                saveFontMeta(next)
                return next
              })
            }
            setCfg((prev) => normalize(Object.assign({}, prev, { fontId: record.id })))
            setBusy('')
            setStatus({
              text: record.saved
                ? '已导入「' + record.label + '」并启用'
                : '「' + record.label + '」本次已启用，但本机存储不可用，重启后需要重新导入',
              error: !record.saved,
            })
            applyAll(state.cfg)
          })
        }).catch((err) => {
          setBusy('')
          setStatus({ text: '导入失败：' + (err && err.message ? err.message : err), error: true })
        })
      }
      const removeCustom = (id) => {
        dbDel(id).catch(() => null)
        setCustoms((prev) => {
          const next = prev.filter((item) => item.id !== id)
          saveFontMeta(next)
          return next
        })
        if (cfg.fontId === id) setCfg((prev) => normalize(Object.assign({}, prev, { fontId: 'default' })))
      }
      const hex = (value) => hexOf(hslToRgb(cfg.hue, cfg.sat, value))
      // 宿主当前用哪套主题只能靠探测：把「现在生效的是哪一行」直接标出来，别让人调错滑块
      const scheme = schemeOf(document)
      const activeLight = scheme === 'dark' ? cfg.darkLight : cfg.lightLight
      const sizeLabel = cfg.fontSize > 0
        ? Math.round(cfg.fontSize) + 'px'
        : '跟随宿主（' + Math.round(baseFontSize) + 'px）'

      return h('div', { className: 'btx-wrap' },
        h('style', null, STYLES),
        h('h2', { className: 'btx-title' }, '字体颜色修改'),
        h('p', { className: 'btx-desc' },
          '统一改界面文字的颜色、字号和字体。颜色按深浅主题各存一个亮度，改完立刻生效，配置保存在本机。'),
        h('p', { className: 'btx-diag' }, diagText(cfg)),
        h('p', { className: 'btx-diag' }, probeLine()),
        h(Row, {
          cfg, rgb: hslToRgb(cfg.hue, cfg.sat, cfg.darkLight), field: 'hue',
          id: 'btx-hue', label: '颜色（色相）', min: 0, max: 360,
          display: String(Math.round(cfg.hue)) + '° ' + hex(cfg.darkLight),
          swatch: hslToRgb(cfg.hue, cfg.sat, cfg.darkLight),
          track: 'linear-gradient(90deg, hsl(0 100% 50%), hsl(60 100% 50%), hsl(120 100% 50%), hsl(180 100% 50%), hsl(240 100% 50%), hsl(300 100% 50%), hsl(360 100% 50%))',
          onChange: pickHue,
        }),
        h(Row, {
          cfg, rgb: hslToRgb(cfg.hue, 100, 50), field: 'sat',
          id: 'btx-sat', label: '饱和度', min: 0, max: 100,
          display: String(Math.round(cfg.sat)) + '%',
          track: 'linear-gradient(90deg, hsl(' + cfg.hue + ' 0% 50%), hsl(' + cfg.hue + ' 100% 50%))',
          onChange: (value) => update({ sat: value }),
        }),
        h(Row, {
          cfg, rgb: hslToRgb(cfg.hue, cfg.sat, 50), field: 'darkLight',
          id: 'btx-dark', label: '深色主题文字亮度', min: 0, max: 100,
          badge: scheme === 'dark' ? '当前主题' : null,
          display: String(Math.round(cfg.darkLight)) + '%（' + hex(cfg.darkLight) + '）',
          track: 'linear-gradient(90deg, hsl(' + cfg.hue + ' ' + cfg.sat + '% 0%), hsl(' + cfg.hue + ' ' + cfg.sat + '% 50%), hsl(' + cfg.hue + ' ' + cfg.sat + '% 100%))',
          onChange: (value) => update({ darkLight: value }),
        }),
        h(Row, {
          cfg, rgb: hslToRgb(cfg.hue, cfg.sat, 50), field: 'lightLight',
          id: 'btx-light', label: '浅色主题文字亮度', min: 0, max: 100,
          badge: scheme === 'light' ? '当前主题' : null,
          display: String(Math.round(cfg.lightLight)) + '%（' + hex(cfg.lightLight) + '）',
          track: 'linear-gradient(90deg, hsl(' + cfg.hue + ' ' + cfg.sat + '% 0%), hsl(' + cfg.hue + ' ' + cfg.sat + '% 50%), hsl(' + cfg.hue + ' ' + cfg.sat + '% 100%))',
          onChange: (value) => update({ lightLight: value }),
        }),
        activeLight >= 96
          ? h('p', { className: 'btx-warn' },
            '当前主题的亮度是 ' + Math.round(activeLight) + '%，纯白 —— 色相和饱和度都会被冲掉，界面看起来像没生效。降到 90% 以下才有颜色。')
          : null,
        h('div', { className: 'btx-presets' },
          PRESETS.map(([name, hue, sat]) => h('button', {
            key: name,
            type: 'button',
            className: 'btx-preset',
            onClick: () => applyPreset(hue, sat),
          },
          h('span', { className: 'btx-dot', style: { background: hslToRgb(hue, sat, cfg.darkLight) } }),
          name))),

        h('div', { className: 'btx-subhead' }, '字号'),
        h('div', { className: 'btx-row' },
          h('div', { className: 'btx-rowhead' },
            h('label', { className: 'btx-label', htmlFor: 'btx-size' }, '正文字号'),
            h('span', { className: 'btx-value' }, sizeLabel)),
          h('input', {
            id: 'btx-size',
            className: 'btx-range',
            type: 'range',
            min: 12,
            max: 22,
            step: 1,
            value: cfg.fontSize > 0 ? cfg.fontSize : Math.round(baseFontSize),
            'aria-label': '正文字号',
            onChange: (event) => update({ fontSize: Number(event.target.value) }),
          }),
          h('div', { className: 'btx-actions', style: { marginTop: '6px' } },
            h('button', {
              type: 'button',
              className: 'btx-btn',
              onClick: () => update({ fontSize: 0 }),
            }, '跟随宿主'),
            h('span', { className: 'btx-hint' }, '只改正文，代码块和终端不动'))),

        h('div', { className: 'btx-subhead' }, '字体'),
        h('div', { className: 'btx-fonts' },
          SYSTEM_FONTS.map((item) => h('button', {
            key: item.id,
            type: 'button',
            className: 'btx-font' + (cfg.fontId === item.id ? ' is-active' : ''),
            onClick: () => pickFont(item.id),
          },
          h('span', { className: 'btx-font-name' }, item.label),
          h('span', { className: 'btx-font-samp', style: { fontFamily: item.stack } }, '永字八法'),
          h('span', { className: 'btx-font-note' }, '系统字体')))),
        h('div', { className: 'btx-fonts' },
          WEB_FONTS.map((item) => h('button', {
            key: item.id,
            type: 'button',
            className: 'btx-font' + (cfg.fontId === item.id ? ' is-active' : ''),
            onClick: () => pickFont(item.id),
            disabled: busy === item.id,
          },
          h('span', { className: 'btx-font-name' }, item.label),
          h('span', { className: 'btx-font-samp', style: { fontFamily: '"' + item.family + '", ' + FALLBACK_STACK } }, '永字八法'),
          h('span', { className: 'btx-font-note' }, busy === item.id ? '准备中…' : item.note + ' · ' + item.size)))),
        customs.length
          ? h('div', { className: 'btx-fonts', style: { marginTop: '8px' } },
            customs.map((item) => h('div', { key: item.id, style: { display: 'flex', gap: '6px', minWidth: 0 } },
              h('button', {
                type: 'button',
                className: 'btx-font' + (cfg.fontId === item.id ? ' is-active' : ''),
                style: { flex: 1, minWidth: 0 },
                onClick: () => pickFont(item.id),
              },
              h('span', { className: 'btx-font-name' }, item.label || '我导入的'),
              h('span', { className: 'btx-font-samp', style: { fontFamily: '"' + customFamilyOf(item.id) + '", ' + FALLBACK_STACK } }, '永字八法'),
              h('span', { className: 'btx-font-note' }, '点一下启用')),
              h('button', {
                type: 'button',
                className: 'btx-btn',
                title: '删除这个字体',
                onClick: () => removeCustom(item.id),
              }, '删除'))))
          : null,
        h('div', { className: 'btx-actions' },
          h('button', {
            type: 'button',
            className: 'btx-btn',
            disabled: busy === 'import',
            onClick: () => fileRef.current && fileRef.current.click(),
          }, busy === 'import' ? '导入中…' : '导入字体文件…'),
          h('button', {
            type: 'button',
            className: 'btx-btn',
            onClick: () => pickFont('default'),
          }, '用默认字体'),
          h('input', {
            ref: fileRef,
            className: 'btx-file',
            type: 'file',
            accept: '.ttf,.otf,.woff,.woff2,.ttc',
            onChange: importFile,
          })),
        status.text ? h('p', { className: 'btx-status' + (status.error ? ' is-err' : '') }, status.text) : null,
        h('p', { className: 'btx-desc', style: { marginTop: '6px' } },
          '开源书法字体（马善政楷书、志莽行书、龙藏体、刘建毛草）均为 SIL Open Font License，可自由使用与再分发；首次选用时自动下载并缓存到本机，之后离线可用。也可以导入自己电脑里的 .ttf / .otf / .woff2 字体文件。'),

        h('div', { className: 'btx-subhead' }, '预览'),
        h(Preview, { cfg }),
        h('div', { className: 'btx-actions' },
          h('button', {
            type: 'button',
            className: 'btx-btn',
            onClick: () => setCfg(normalize(DEFAULTS)),
          }, '恢复默认'),
          h('span', { className: 'btx-hint' }, '默认：白字 + 跟随宿主字号 + 默认字体')))
    }

    const state = {
      cfg: loadConfig(),
      timer: null,
      observer: null,
    }

    let rafId = 0
    function scheduleApply() {
      if (typeof requestAnimationFrame !== 'function') {
        applyAll(state.cfg)
        return
      }
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        applyAll(state.cfg)
      })
    }

    function startGuards() {
      // 插件被重新 apply 时不要叠第二套定时器和观察器
      if (state.timer || state.guardsStarted) return
      state.guardsStarted = true
      const opts = { attributes: true, attributeFilter: ['style', 'class', 'data-ds-dark-theme', 'data-ds-theme-source'] }
      try {
        state.observer = new MutationObserver(scheduleApply)
        state.observer.observe(document.documentElement, opts)
        if (document.body) state.observer.observe(document.body, opts)
      } catch (err) {
        // 没有 MutationObserver 就只靠定时自检
      }
      // 宿主切主题、改字体都会重写 body 内联样式，定期对齐一次；1.2s 的开销可以忽略
      state.timer = setInterval(() => {
        if (document.visibilityState === 'hidden') return
        repair(state.cfg)
      }, 1200)
      document.addEventListener('visibilitychange', scheduleApply)
      window.addEventListener('focus', scheduleApply)
      try {
        const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)')
        if (mq && mq.addEventListener) mq.addEventListener('change', scheduleApply)
      } catch (err) {
        // 老内核没有 addEventListener 就算了，定时自检也会补救
      }
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => applyAll(state.cfg))
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => applyAll(state.cfg))
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        state.cfg = loadConfig()
        applyAll(state.cfg)
        // 上次选的字体可能还没注册（重启后），异步补一次
        ensureFontLoaded(state.cfg.fontId).then(() => applyAll(state.cfg)).catch(() => null)
        try {
          startGuards()
        } catch (err) {
          // 守卫起不来时至少样式表那层还在
        }
        try {
          ctx.slots.inject('settings.section', () => ctx.slots.register({
            name: 'settings.section',
            id: 'bright-text',
            order: 90,
            label: () => '字体颜色修改',
          }, TextColorSection))
        } catch (err) {
          // 老版本没有 settings.section 时退化成只有 CSS，不阻断插件加载
        }
      },
    }
  },
})
