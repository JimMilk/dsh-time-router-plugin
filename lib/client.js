// dsh-time-router-plugin 客户端 bundle（手写惰性 CJS 表，对应 tsdown 编译产物格式）
// 会话头角标（当前上游/峰谷/今日费用）+ 设置页「智能路由」状态卡
window.__ModuleLoader__.load({
  id: '@jim/dsh-time-router-plugin',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var react = require('react')

    var NS = 'time-router'
    var STATUS_URL = '/time-router/status'

    function useStatus(pollMs) {
      var state = react.useState(null)
      var data = state[0]
      var setData = state[1]
      react.useEffect(function () {
        var alive = true
        function load() {
          fetch(STATUS_URL, { cache: 'no-store' })
            .then(function (r) { if (!r.ok) throw new Error('status ' + r.status); return r.json() })
            .then(function (d) { if (alive) setData(d) })
            .catch(function () { /* 静默：网络瞬时失败不打断 UI */ })
        }
        load()
        var timer = setInterval(load, pollMs)
        return function () { alive = false; clearInterval(timer) }
      }, [pollMs])
      return data
    }

    function StatusBadge() {
      var data = useStatus(10000)
      var openState = react.useState(false)
      var open = openState[0]
      var setOpen = openState[1]
      if (!data) {
        return react.createElement('span', { className: 'tr-badge tr-badge--unknown', title: '智能路由' }, '路由…')
      }
      var provider = data.activeProvider || '?'
      var isScnet = provider.indexOf('scnet') !== -1
      var cost = data.today ? (data.today.costCny || 0).toFixed(2) : '0.00'
      var peakLabel = data.peak ? '峰' : '谷'
      var cooling = Object.keys(data.state || {}).filter(function (k) { return data.state[k].status === 'cooling' }).length
      var bal = data.balances
      var total = bal && bal.ok && bal.balances && bal.balances.length > 0 ? Number(bal.balances[0].total_balance) : 0
      var used = data.today ? (data.today.costCny || 0) : 0
      var usedPct = total > 0 ? Math.min(100, Math.round(used / (total + used) * 100)) : 0
      return react.createElement(
        'span',
        { className: 'tr-badge-wrap' },
        react.createElement('button',
          {
            type: 'button',
            className: 'tr-badge ' + (isScnet ? 'tr-badge--scnet' : 'tr-badge--official'),
            onClick: function () { setOpen(!open) },
            title: '点击查看智能路由状态',
          },
          react.createElement('span', { className: 'tr-badge-dot ' + (cooling > 0 ? 'tr-dot--bad' : 'tr-dot--ok') }),
          ' ',
          provider, ' ', peakLabel, ' ¥', cost,
          react.createElement('span', { className: 'tr-badge-bar' },
            react.createElement('span', { className: 'tr-badge-bar-fill', style: { width: usedPct + '%' } }),
          ),
        ),
        open
          ? react.createElement(StatusPopover, { data: data, onClose: function () { setOpen(false) } })
          : null,
      )
    }

    function StatusPopover(props) {
      var data = props.data
      var today = data.today || {}
      var states = data.state || {}
      var bal = data.balances
      var deepseekTotal = bal && bal.ok && bal.balances && bal.balances.length > 0 ? Number(bal.balances[0].total_balance) : 0
      var deepseekUsed = today.costCny || 0
      var deepseekPct = deepseekTotal > 0 ? Math.min(100, Math.round(deepseekUsed / (deepseekTotal + deepseekUsed) * 100)) : 0
      var scnetManual = data.scnetManualCny != null ? Number(data.scnetManualCny) : 0
      var scnetCredits = today.credits || 0
      var scnetPct = scnetManual > 0 ? Math.min(100, Math.round(scnetCredits / (scnetManual + scnetCredits) * 100)) : 0
      var scnetUnitLabel = data.scnetUnit === 'credits' ? 'credits' : '¥'
      var healthItems = Object.keys(states).map(function (k) {
        var s = states[k]
        var label = s.status === 'cooling'
          ? '冷却中 ' + Math.max(0, Math.ceil((s.coolUntil - Date.now()) / 1000)) + 's'
          : s.status === 'half-open' ? '恢复中' : '健康'
        return react.createElement('li', { key: k, title: s.lastError ? String(s.lastError) : '' },
          react.createElement('span', { className: DOT_CLASS[s.status] || 'tr-dot' }),
          ' ', k, '：', label,
        )
      })
      if (healthItems.length === 0) healthItems.push(react.createElement('li', { key: 'none' }, '暂无请求记录'))
      return react.createElement(
        'div',
        { className: 'tr-popover' },
        react.createElement('div', { className: 'tr-popover-head' },
          '智能路由',
          react.createElement('button', { type: 'button', onClick: props.onClose }, '✕'),
        ),
        react.createElement('div', { className: 'tr-popover-body' },
          react.createElement('div', { className: 'tr-card' },
            react.createElement('h4', null, '入口健康'),
            react.createElement('ul', null, healthItems),
          ),
          react.createElement('div', { className: 'tr-card' },
            react.createElement('h4', null, '额度'),
            react.createElement('div', { className: 'tr-quota' },
              react.createElement('span', { className: 'tr-quota-label' }, 'deepseek 官方'),
              react.createElement('span', { className: 'tr-bar' },
                react.createElement('span', { className: 'tr-bar-fill tr-bar-fill--used', style: { width: deepseekPct + '%' } }),
              ),
              react.createElement('span', { className: 'tr-quota-text' }, '已用 ¥' + deepseekUsed.toFixed(2), ' / 余额 ¥' + (deepseekTotal || '?')),
            ),
            react.createElement('div', { className: 'tr-quota' },
              react.createElement('span', { className: 'tr-quota-label' }, 'scnet'),
              react.createElement('span', { className: 'tr-bar' },
                react.createElement('span', { className: 'tr-bar-fill tr-bar-fill--scnet', style: { width: scnetPct + '%' } }),
              ),
              react.createElement('span', { className: 'tr-quota-text' },
                'credits ' + scnetCredits.toFixed(2),
                scnetManual > 0 ? ' / 余额 ' + scnetUnitLabel + scnetManual : '（未设余额）',
              ),
            ),
          ),
          react.createElement('div', { className: 'tr-card' },
            react.createElement('h4', null, '今日'),
            react.createElement('p', null, '请求 ', today.requests || 0, ' / 探测 ', today.probes || 0,
              '；Token 入 ', today.tokens ? today.tokens.input : 0, ' 出 ', today.tokens ? today.tokens.output : 0),
            react.createElement('ul', null, Object.keys(today.byProvider || {}).map(function (p) {
              var b = today.byProvider[p]
              return react.createElement('li', { key: p },
                p, '：入 ', b.input, ' / 出 ', b.output,
                b.costCny ? '，¥' + Number(b.costCny).toFixed(4) : '',
              )
            })),
            react.createElement('p', null, '当前上游 ', data.activeProvider || '–', '（', data.peak ? '高峰' : '空闲', '）'),
          ),
        ),
      )
    }

    function fmtState(state) {
      if (!state) return '–'
      if (state.status === 'cooling') return '冷却中'
      if (state.status === 'half-open') return '恢复中'
      return '健康'
    }

    // ---------------- 路由编辑器（时段 × 优先级） ----------------
    var uidSeq = 0
    function newId() { return 'slot-' + Date.now().toString(36) + '-' + (++uidSeq) }

    function clone(v) { return JSON.parse(JSON.stringify(v)) }

    function timeToMin(t) {
      var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''))
      if (!m) return null
      var h = Number(m[1]); var mm = Number(m[2])
      if (h > 23 || mm > 59) return null
      return h * 60 + mm
    }

    function intervalOf(slot) {
      var s = timeToMin(slot.start); var e = timeToMin(slot.end)
      if (s === null || e === null) return null
      if (s === e) return [0, 1440]
      if (e < s) return [s, e + 1440]
      return [s, e]
    }

    function slotsOverlap(a, b) {
      var ad = Array.isArray(a.days) && a.days.length > 0 ? a.days : null
      var bd = Array.isArray(b.days) && b.days.length > 0 ? b.days : null
      var daysIntersect = ad === null || bd === null || ad.some(function (d) { return bd.indexOf(d) !== -1 })
      if (!daysIntersect) return false
      var ai = intervalOf(a); var bi = intervalOf(b)
      if (!ai || !bi) return false
      if (ai[0] === 0 && ai[1] === 1440) return true
      if (bi[0] === 0 && bi[1] === 1440) return true
      var shifts = [0, 1440, -1440]
      for (var i = 0; i < shifts.length; i++) {
        var s = bi[0] + shifts[i]; var e = bi[1] + shifts[i]
        if (s < 0 || e > 2880) continue
        if (ai[0] < e && s < ai[1]) return true
      }
      return false
    }

    function validateDraft(routing) {
      var errors = []
      var slots = routing && Array.isArray(routing.slots) ? routing.slots : []
      for (var i = 0; i < slots.length; i++) {
        var s = slots[i]
        if (timeToMin(s.start) === null) errors.push('时段「' + (s.name || i + 1) + '」开始时间格式应为 HH:MM')
        if (timeToMin(s.end) === null) errors.push('时段「' + (s.name || i + 1) + '」结束时间格式应为 HH:MM')
        if (!Array.isArray(s.priority) || s.priority.length === 0) {
          errors.push('时段「' + (s.name || i + 1) + '」至少需要一个优先级条目')
        }
        for (var k = 0; k < i; k++) {
          if (slotsOverlap(s, slots[k])) errors.push('时段「' + (s.name || i + 1) + '」与「' + (slots[k].name || k + 1) + '」时间重叠')
        }
      }
      return errors
    }

    var DAYS_OPTIONS = [
      { value: 'every', label: '每天' },
      { value: 'weekday', label: '工作日' },
      { value: 'weekend', label: '周末' },
    ]
    function daysToKey(days) {
      if (!Array.isArray(days) || days.length === 0) return 'every'
      if (days.length === 5 && [1, 2, 3, 4, 5].every(function (d) { return days.indexOf(d) !== -1 })) return 'weekday'
      if (days.length === 2 && days.indexOf(0) !== -1 && days.indexOf(6) !== -1) return 'weekend'
      return 'every'
    }
    function keyToDays(key) {
      if (key === 'weekday') return [1, 2, 3, 4, 5]
      if (key === 'weekend') return [0, 6]
      return undefined
    }

    function PriorityRow(props) {
      var entry = props.entry
      var providers = props.providers || []
      var models = props.modelsOf ? props.modelsOf(entry.provider) : []
      var providerKnown = providers.some(function (p) { return p.id === entry.provider })
      var modelKnown = models.some(function (m) { return m.id === entry.model })
      return react.createElement(
        'div',
        {
          className: 'tr-row'
            + (props.dragging ? ' tr-row--dragging' : '')
            + (props.over ? ' tr-row--over' : ''),
          style: props.dragging ? { transform: 'translateY(' + props.dy + 'px)', zIndex: 10, opacity: 0.6 } : undefined,
        },
        react.createElement('span', {
          className: 'tr-drag',
          title: '按住拖动排序',
          onPointerDown: function (e) { props.onHandleDown(e, props.index) },
        }, '≡'),
        react.createElement('select',
          {
            value: entry.provider,
            onChange: function (e) {
              var next = clone(entry)
              next.provider = e.target.value
              var first = props.modelsOf(e.target.value)[0]
              next.model = first ? first.id : ''
              props.onChange(next)
            },
          },
          providers.map(function (p) {
            return react.createElement('option', { key: p.id, value: p.id }, p.name)
          }),
        ),
        react.createElement('select',
          {
            value: modelKnown ? entry.model : '',
            onChange: function (e) {
              var next = clone(entry)
              next.model = e.target.value
              props.onChange(next)
            },
          },
          models.map(function (m) {
            return react.createElement('option', { key: m.id, value: m.id }, m.name || m.id)
          }),
          !providerKnown
            ? react.createElement('option', { key: '__stale', value: '' }, '（供应商失效）')
            : models.length === 0
              ? react.createElement('option', { key: '__empty', value: '' }, '（无模型）')
              : !modelKnown
                ? react.createElement('option', { key: '__stale2', value: '' }, entry.model + '（失效）')
                : null,
        ),
        react.createElement('button', { type: 'button', onClick: props.onUp, disabled: props.index === 0 }, '↑'),
        react.createElement('button', { type: 'button', onClick: props.onDown, disabled: props.index === props.count - 1 }, '↓'),
        react.createElement('button', { type: 'button', onClick: props.onRemove }, '删除'),
      )
    }

    function SlotCard(props) {
      var slot = props.slot
      var listRef = react.useRef(null)
      var dragRef = react.useRef(null)
      var dragViewState = react.useState(null)
      var dragView = dragViewState[0]
      var setDragView = dragViewState[1]
      var handleDown = function (e, index) {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        dragRef.current = { index: index, y: e.clientY, over: index }
        setDragView({ index: index, dy: 0, over: index })
      }
      var handleMove = function (e) {
        var d = dragRef.current
        if (!d) return
        var dy = e.clientY - d.y
        var over = d.index
        var container = listRef.current
        if (container) {
          var rows = container.querySelectorAll('.tr-row')
          for (var i = 0; i < rows.length; i++) {
            var r = rows[i].getBoundingClientRect()
            if (e.clientY < r.top + r.height / 2) { over = i; break }
            over = rows.length - 1
          }
        }
        d.over = over
        setDragView({ index: d.index, dy: dy, over: over })
      }
      var handleUp = function () {
        var d = dragRef.current
        if (d) {
          if (d.over != null && d.over !== d.index) {
            var list = clone(slot.priority || [])
            var moved = list.splice(d.index, 1)[0]
            list.splice(d.over, 0, moved)
            setPriority(list)
          }
          dragRef.current = null
          setDragView(null)
        }
      }
      var setSlot = function (patch) { props.onChange(Object.assign({}, slot, patch)) }
      var setPriority = function (list) { setSlot({ priority: list }) }
      var daysKey = daysToKey(slot.days)
      return react.createElement(
        'fieldset',
        { className: 'tr-slot' },
        react.createElement('legend', null, '时段'),
        react.createElement('input',
          {
            placeholder: '名称（如 白天）',
            value: slot.name || '',
            onChange: function (e) { setSlot({ name: e.target.value }) },
          },
        ),
        ' 开始 ',
        react.createElement('input', { value: slot.start || '', style: { width: '5em' }, onChange: function (e) { setSlot({ start: e.target.value }) } }),
        ' 结束 ',
        react.createElement('input', { value: slot.end || '', style: { width: '5em' }, onChange: function (e) { setSlot({ end: e.target.value }) } }),
        ' 适用 ',
        react.createElement('select',
          {
            value: daysKey,
            onChange: function (e) {
              var days = keyToDays(e.target.value)
              var next = Object.assign({}, slot)
              if (days === undefined) delete next.days
              else next.days = days
              props.onChange(next)
            },
          },
          DAYS_OPTIONS.map(function (o) { return react.createElement('option', { key: o.value, value: o.value }, o.label) }),
        ),
        react.createElement('button', { type: 'button', onClick: props.onRemove, style: { float: 'right' } }, '删除时段'),
        react.createElement('div', {
          className: 'tr-priority',
          ref: listRef,
          onPointerMove: handleMove,
          onPointerUp: handleUp,
          onPointerCancel: handleUp,
        },
          '优先级（从上到下尝试）',
          (slot.priority || []).map(function (entry, i) {
            return react.createElement(PriorityRow, {
              key: entry._k || i,
              entry: entry,
              index: i,
              count: (slot.priority || []).length,
              providers: props.providers,
              modelsOf: props.modelsOf,
              dragging: dragView !== null && dragView.index === i,
              dy: dragView !== null && dragView.index === i ? dragView.dy : 0,
              over: dragView !== null && dragView.over === i && dragView.index !== i,
              onHandleDown: handleDown,
              onChange: function (next) {
                var list = clone(slot.priority || [])
                list[i] = next
                setPriority(list)
              },
              onUp: function () {
                var list = clone(slot.priority || [])
                if (i > 0) { var t = list[i - 1]; list[i - 1] = list[i]; list[i] = t; setPriority(list) }
              },
              onDown: function () {
                var list = clone(slot.priority || [])
                if (i < list.length - 1) { var t = list[i + 1]; list[i + 1] = list[i]; list[i] = t; setPriority(list) }
              },
              onRemove: function () {
                var list = clone(slot.priority || [])
                list.splice(i, 1)
                setPriority(list)
              },
            })
          }),
          react.createElement('button', {
            type: 'button',
            onClick: function () {
              var list = clone(slot.priority || [])
              var first = props.firstEntry
              list.push(first
                ? { provider: first.provider, model: first.model, _k: newId() }
                : { provider: '', model: '', _k: newId() })
              setPriority(list)
            },
          }, '+ 添加优先级'),
        ),
      )
    }

    function RoutingEditor(props) {
      var scope = props.scope
      var snapshot = react.useSyncExternalStore(
        function (cb) { return scope.subscribe(cb) },
        function () { return scope.getSnapshot() },
      )
      var resolved = snapshot && snapshot.value
      var directory = props.directory
      var providers = (directory.groups || []).filter(function (g) { return g.id !== 'time-router' })
      var modelsOf = function (provider) {
        var g = (directory.groups || []).filter(function (x) { return x.id === provider })[0]
        return g ? g.models : []
      }
      var firstEntry = providers.length > 0
        ? { provider: providers[0].id, model: modelsOf(providers[0].id)[0] ? modelsOf(providers[0].id)[0].id : '' }
        : null
      var defaultRouting = { slots: [], defaultFallback: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }
      var draftState = react.useState(function () {
        return clone((resolved && resolved.routing) || defaultRouting)
      })
      var draft = draftState[0]
      var setDraft = draftState[1]
      var dirtyState = react.useState(false)
      var dirty = dirtyState[0]
      var setDirty = dirtyState[1]
      var msgState = react.useState('')
      var msg = msgState[0]
      var setMsg = msgState[1]
      var savedRouting = resolved && resolved.routing
      var lastSaved = react.useRef(JSON.stringify(savedRouting || {}))
      react.useEffect(function () {
        var currentJson = JSON.stringify(resolved && resolved.routing)
        if (!dirty && lastSaved.current !== currentJson) {
          lastSaved.current = currentJson
          setDraft(clone((resolved && resolved.routing) || defaultRouting))
        }
      })
      if (!snapshot || snapshot.status === 'loading') {
        return react.createElement('p', null, '加载设置中…')
      }
      if (snapshot.status === 'unavailable') {
        return react.createElement('p', null, 'time-router 设置命名空间不可用（请确认插件已加载）')
      }
      var errors = validateDraft(draft)
      var onSave = function () {
        if (errors.length > 0) { setMsg('无法保存：' + errors.join('；')); return }
        var clean = clone(draft)
        clean.slots.forEach(function (s) {
          s.priority.forEach(function (p) { delete p._k })
          if (s.days === undefined) delete s.days
        })
        scope.set('routing', clean).then(function () {
          setDirty(false)
          setMsg('已保存')
          lastSaved.current = JSON.stringify(clean)
        }).catch(function (e) {
          setMsg('保存失败：' + (e && e.message ? e.message : String(e)))
        })
      }
      return react.createElement(
        'div',
        { className: 'tr-editor' },
        react.createElement('h3', null, '时段 × 优先级路由表'),
        react.createElement('p', { className: 'tr-hint' }, '按当前时段优先级从上到下尝试供应商×模型；失败自动降级并冷却。'),
        (draft.slots || []).map(function (slot, i) {
          return react.createElement(SlotCard, {
            key: slot._k || i,
            slot: slot,
            providers: providers,
            modelsOf: modelsOf,
            firstEntry: firstEntry,
            onChange: function (next) {
              var list = clone(draft.slots || [])
              list[i] = next
              setDraft(Object.assign({}, draft, { slots: list }))
              setDirty(true)
            },
            onRemove: function () {
              var list = clone(draft.slots || [])
              list.splice(i, 1)
              setDraft(Object.assign({}, draft, { slots: list }))
              setDirty(true)
            },
          })
        }),
        react.createElement('button', {
          type: 'button',
          onClick: function () {
            var list = clone(draft.slots || [])
            list.push({
              _k: newId(),
              id: newId(),
              name: '',
              start: '09:00',
              end: '18:00',
              priority: providers.length > 0
                ? [{ provider: providers[0].id, model: modelsOf(providers[0].id)[0] ? modelsOf(providers[0].id)[0].id : '', _k: newId() }]
                : [],
            })
            setDraft(Object.assign({}, draft, { slots: list }))
            setDirty(true)
          },
        }, '+ 添加时段'),
        react.createElement('div', { className: 'tr-fallback' },
          '无时段匹配时的兜底：',
          react.createElement('select', {
            value: (draft.defaultFallback || {}).provider || '',
            onChange: function (e) {
              var p = e.target.value
              var m = modelsOf(p)[0] ? modelsOf(p)[0].id : ''
              setDraft(Object.assign({}, draft, { defaultFallback: { provider: p, model: m } }))
              setDirty(true)
            },
          }, providers.map(function (g) { return react.createElement('option', { key: g.id, value: g.id }, g.name) })),
          react.createElement('select', {
            value: (draft.defaultFallback || {}).model || '',
            onChange: function (e) {
              setDraft(Object.assign({}, draft, { defaultFallback: Object.assign({}, draft.defaultFallback, { model: e.target.value }) }))
              setDirty(true)
            },
          }, modelsOf((draft.defaultFallback || {}).provider).map(function (m) {
            return react.createElement('option', { key: m.id, value: m.id }, m.name || m.id)
          })),
        ),
        react.createElement('div', { className: 'tr-actions' },
          react.createElement('button', { type: 'button', onClick: onSave }, '保存'),
          react.createElement('button', {
            type: 'button',
            onClick: function () {
              setDraft(clone(savedRouting || { slots: [], defaultFallback: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }))
              setDirty(false)
              setMsg('')
            },
          }, '放弃修改'),
          dirty ? react.createElement('span', { className: 'tr-dirty' }, '（未保存）') : null,
        ),
        errors.length > 0 ? react.createElement('ul', { className: 'tr-errors' }, errors.map(function (e, i) {
          return react.createElement('li', { key: i }, e)
        })) : null,
        msg ? react.createElement('p', { className: 'tr-msg' }, msg) : null,
      )
    }

    var DOT_CLASS = { healthy: 'tr-dot tr-dot--ok', 'half-open': 'tr-dot tr-dot--half', cooling: 'tr-dot tr-dot--bad' }

    function ScnetBalanceInput(props) {
      var state = react.useState(props.value != null ? String(props.value) : '')
      var val = state[0]
      var setVal = state[1]
      var unitState = react.useState(props.unit === 'credits' ? 'credits' : 'cny')
      var unit = unitState[0]
      var setUnit = unitState[1]
      var savedState = react.useState('')
      var saved = savedState[0]
      var setSaved = savedState[1]
      var save = function () {
        var n = Number(val)
        if (!Number.isFinite(n) || n < 0) { setSaved('请输入非负数字'); return }
        props.scope.set('scnetBalance', { manualCny: n, unit: unit }).then(function () {
          setSaved('已保存')
        }).catch(function (e) {
          setSaved('保存失败：' + (e && e.message ? e.message : String(e)))
        })
      }
      return react.createElement('span', null,
        react.createElement('input', {
          type: 'number',
          min: '0',
          step: '0.01',
          value: val,
          onChange: function (e) { setVal(e.target.value); setSaved('') },
          style: { width: '8em' },
          placeholder: '手动余额 ¥',
        }),
        react.createElement('select', {
          value: unit,
          onChange: function (e) { setUnit(e.target.value); setSaved('') },
        },
          react.createElement('option', { value: 'cny' }, '元'),
          react.createElement('option', { value: 'credits' }, 'credits'),
        ),
        react.createElement('button', { type: 'button', onClick: save }, '保存'),
        saved ? react.createElement('span', { className: 'tr-sub' }, ' ', saved) : null,
      )
    }

    function TrendChart(props) {
      var trend = props.trend || []
      var max = 1
      trend.forEach(function (d) {
        Object.keys(d.byProvider || {}).forEach(function (p) {
          var b = d.byProvider[p]
          var t = (b.input || 0) + (b.output || 0)
          if (t > max) max = t
        })
      })
      return react.createElement('div', { className: 'tr-trend' },
        trend.map(function (d) {
          var segs = Object.keys(d.byProvider || {}).map(function (p) {
            var b = d.byProvider[p]
            var t = (b.input || 0) + (b.output || 0)
            var h = max > 0 ? Math.max(2, Math.round(t / max * 100)) : 2
            return react.createElement('span', {
              key: p,
              className: 'tr-trend-seg ' + (p.indexOf('scnet') !== -1 ? 'tr-trend--scnet' : 'tr-trend--official'),
              style: { height: h + '%' },
              title: d.date + ' ' + p + '：' + t + ' tokens，¥' + (b.costCny || 0).toFixed(2),
            })
          })
          if (segs.length === 0) {
            segs.push(react.createElement('span', { key: 'z', className: 'tr-trend-seg', style: { height: '2%' } }))
          }
          return react.createElement('div', {
            key: d.date,
            className: 'tr-trend-col',
            title: d.date + ' 请求 ' + (d.requests || 0) + ' / 费用 ¥' + (d.costCny || 0).toFixed(2),
          },
            react.createElement('div', { className: 'tr-trend-bars' }, segs),
            react.createElement('span', { className: 'tr-trend-date' }, d.date.slice(5)),
          )
        }),
      )
    }

    function TestRoute(props) {
      var state = react.useState(null)
      var st = state[0]
      var setSt = state[1]
      var run = function () {
        setSt({ running: true, results: null, error: null })
        fetch('/time-router/test', { cache: 'no-store' })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
          .then(function (d) { setSt({ running: false, results: d.results || [], error: null }) })
          .catch(function (e) { setSt({ running: false, results: null, error: String((e && e.message) || e) }) })
      }
      return react.createElement('div', { className: 'tr-test' },
        react.createElement('button', { type: 'button', onClick: run, disabled: st && st.running },
          st && st.running ? '测试中…' : '测试当前路由'),
        st && st.results ? react.createElement('ul', null, st.results.map(function (r, i) {
          return react.createElement('li', { key: i },
            r.provider + '/' + r.model, '：', r.ok ? 'OK' : '失败（' + r.code + '）', ' ', r.ms + 'ms')
        })) : null,
        st && st.error ? react.createElement('p', { className: 'tr-errors' }, '测试失败：' + st.error) : null,
      )
    }

    function StatusDashboard(props) {
      var data = props.data
      var states = data.state || {}
      var today = data.today || {}
      var byProvider = today.byProvider || {}
      var bal = data.balances
      var deepseekTotal = bal && bal.ok && bal.balances && bal.balances.length > 0 ? bal.balances[0].total_balance : null
      var gated = (data.budget && data.budget.gated) || []
      var providerRows = Object.keys(byProvider).map(function (p) {
        var b = byProvider[p]
        return react.createElement('li', { key: p },
          p, '：入 ', b.input, ' / 出 ', b.output,
          '，¥', (b.costCny || 0).toFixed(4),
          b.credits ? '，credits ' + Number(b.credits).toFixed(2) : '',
        )
      })
      var entries = Object.keys(states).map(function (k) {
        var s = states[k]
        return react.createElement('li', { key: k, title: s.lastError ? String(s.lastError) : '' },
          react.createElement('span', { className: DOT_CLASS[s.status] || 'tr-dot' }),
          ' ', k, '：', fmtState(s),
          s.status === 'cooling' ? react.createElement('span', { className: 'tr-cool-until' }, '（' + Math.max(0, Math.ceil((s.coolUntil - Date.now()) / 1000)) + 's）') : null,
        )
      })
      if (entries.length === 0) entries.push(react.createElement('li', { key: 'none' }, '暂无请求记录'))
      return react.createElement(
        'div',
        { className: 'tr-dashboard' },
        react.createElement('div', { className: 'tr-card' },
          react.createElement('h4', null, '入口健康状态'),
          react.createElement('ul', null, entries),
          react.createElement('p', { className: 'tr-sub' },
            '当前上游：', data.activeProvider || '–', '（', data.peak ? '高峰' : '空闲', '）'),
        ),
        react.createElement('div', { className: 'tr-card' },
          react.createElement('h4', null, '已用额度（今日）'),
          react.createElement('p', null, '费用：¥', (today.costCny || 0).toFixed(4)),
          react.createElement('p', null, 'Token：输入 ', today.tokens ? today.tokens.input : 0, ' / 输出 ',
            today.tokens ? today.tokens.output : 0, ' / 缓存读 ', today.tokens ? today.tokens.cacheRead : 0),
          providerRows.length > 0
            ? react.createElement('ul', null, providerRows)
            : react.createElement('p', { className: 'tr-sub' }, '暂无分供应商记录'),
          react.createElement('p', null, '请求 ', today.requests || 0, ' 次 / 探测 ', today.probes || 0, ' 次'),
        ),
        react.createElement('div', { className: 'tr-card' },
          react.createElement('h4', null, '剩余额度'),
          react.createElement('p', null, 'deepseek 官方：',
            deepseekTotal !== null ? '¥' + String(deepseekTotal) : '获取失败（' + (data.balanceError || '?') + '）'),
          react.createElement('p', null, 'scnet：',
            data.scnetManualCny != null
              ? (data.scnetUnit === 'credits' ? String(data.scnetManualCny) + ' credits（手动）' : '¥' + String(data.scnetManualCny) + '（手动）')
              : '未设置'),
          react.createElement('p', null, '填写 scnet 手动余额：',
            react.createElement(ScnetBalanceInput, { scope: props.scope, value: data.scnetManualCny, unit: data.scnetUnit })),
          react.createElement('p', { className: 'tr-sub' }, 'scnet credits 估算：', (today.credits || 0).toFixed(2)),
        ),
        gated.length > 0
          ? react.createElement('p', { className: 'tr-gated' },
              'scnet 余额低于阈值，已自动跳过：', gated.join('、'),
              '（可在设置中调整阈值或关闭自动降级）')
          : null,
        react.createElement('div', { className: 'tr-card tr-card--wide' },
          react.createElement('h4', null, '近 7 天用量（tokens，按供应商堆叠）'),
          react.createElement(TrendChart, { trend: data.trend || [] }),
          react.createElement(TestRoute, null),
        ),
      )
    }

    function StatusPage() {
      var data = useStatus(10000)
      var body
      if (!data) {
        body = react.createElement('p', null, '加载状态中…')
      } else {
        body = react.createElement('div', null,
          react.createElement(StatusDashboard, { key: 'dash', data: data, scope: timeRouterScope }),
          react.createElement(RoutingEditor, { key: 'editor', scope: timeRouterScope, directory: modelDirectory }),
        )
      }
      return react.createElement('div', { className: 'tr-settings' }, body)
    }

    exports.name = 'time-router-client'
    exports.inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']
    var timeRouterScope = null
    var modelDirectory = { groups: [] }

    exports.apply = function (ctx) {
      ctx.locale.register(NS, { zh: {}, en: {} })
      if (typeof document !== 'undefined' && !document.getElementById('tr-style')) {
        var style = document.createElement('style')
        style.id = 'tr-style'
        style.textContent = [
          '.tr-badge-wrap{position:relative;display:inline-flex;align-items:center}',
          '.tr-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;border:1px solid;font-size:12px;cursor:pointer;background:transparent;font-family:inherit}',
          '.tr-badge--scnet{border-color:#2e7d32;color:#2e7d32}',
          '.tr-badge--official{border-color:#1565c0;color:#1565c0}',
          '.tr-badge--unknown{border-color:#9e9e9e;color:#9e9e9e}',
          '.tr-badge-dot{width:8px;height:8px;border-radius:50%;display:inline-block}',
          '.tr-dot{width:8px;height:8px;border-radius:50%;display:inline-block;background:#9e9e9e}',
          '.tr-dot--ok{background:#2e7d32}.tr-dot--half{background:#f9a825}.tr-dot--bad{background:#c62828}',
          '.tr-badge-bar{width:42px;height:4px;border-radius:2px;background:rgba(127,127,127,.25);overflow:hidden;display:inline-block}',
          '.tr-badge-bar-fill{display:block;height:100%;background:currentColor}',
          '.tr-popover{position:fixed;top:64px;right:16px;z-index:9999;width:300px;background:#ffffff;color:#1f2328;border:1px solid rgba(31,35,40,.15);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);font-size:13px;font-family:inherit}',
          '.tr-popover-head{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #eaeef2;font-weight:600}',
          '.tr-popover-head button{border:none;background:none;cursor:pointer;font-size:13px;color:#57606a}',
          '.tr-popover-body{padding:10px 14px 14px;max-height:70vh;overflow:auto}',
          '.tr-card{margin-bottom:10px}.tr-card h4{margin:6px 0 4px;font-size:12px;color:#57606a}.tr-card ul{margin:2px 0;padding-left:16px}.tr-card p{margin:2px 0}',
          '.tr-quota{display:grid;grid-template-columns:86px 1fr;gap:4px 8px;align-items:center;margin:5px 0}',
          '.tr-quota-label{font-size:12px;color:#57606a}',
          '.tr-bar{height:8px;border-radius:4px;background:#eaeef2;overflow:hidden;display:block}',
          '.tr-bar-fill{display:block;height:100%}.tr-bar-fill--used{background:#1565c0}.tr-bar-fill--scnet{background:#2e7d32}',
          '.tr-quota-text{grid-column:2;font-size:11px;color:#57606a}',
          '.tr-editor h3{margin:14px 0 6px}.tr-hint{color:#57606a;font-size:12px;margin:4px 0 10px}',
          '.tr-slot{border:1px solid rgba(127,127,127,.35);border-radius:8px;padding:8px 10px;margin:8px 0}',
          '.tr-slot input,.tr-slot select{margin:2px 4px;padding:2px 6px;font-size:13px}',
          '.tr-priority{margin-top:8px;font-size:13px}',
          '.tr-row{display:grid;grid-template-columns:1.4em 10em 15em auto auto auto;align-items:center;gap:6px;margin:4px 0;padding:4px 6px;border:1px solid transparent;border-radius:6px;position:relative}',
          '.tr-row select{width:100%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
          '.tr-row button{width:2.4em;padding:2px 0;font-size:12px}',
          '.tr-row--dragging{opacity:.45;border-style:dashed;border-color:#1565c0}',
          '.tr-row--over{background:rgba(21,101,192,.12);border-color:#1565c0}',
          '.tr-drag{cursor:grab;color:#57606a;user-select:none;-webkit-user-select:none;touch-action:none;padding:0 2px;text-align:center}',
          '.tr-fallback{margin:10px 0}.tr-actions{margin:10px 0;display:flex;gap:8px;align-items:center}',
          '.tr-dirty{color:#f9a825;font-size:12px}.tr-errors{color:#c62828;font-size:12px;margin:6px 0}.tr-msg{font-size:12px;margin:6px 0}',
          '.tr-dashboard{display:flex;gap:10px;flex-wrap:wrap}.tr-dashboard .tr-card{flex:1;min-width:180px;border:1px solid rgba(127,127,127,.25);border-radius:8px;padding:8px 10px;margin:0}',
          '.tr-sub{color:#57606a;font-size:11px}',
          '.tr-cool-until{color:#c62828;font-size:11px}',
          '.tr-gated{color:#c62828;font-size:12px;margin:6px 0}',
          '.tr-card--wide{flex-basis:100%;min-width:100%}',
          '.tr-trend{display:flex;gap:6px;align-items:flex-end;height:90px;margin:6px 0}',
          '.tr-trend-col{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;height:100%;min-width:0}',
          '.tr-trend-bars{flex:1;width:100%;display:flex;flex-direction:column;justify-content:flex-end;gap:1px}',
          '.tr-trend-seg{display:block;width:100%;border-radius:2px}',
          '.tr-trend--scnet{background:#2e7d32}.tr-trend--official{background:#1565c0}',
          '.tr-trend-date{font-size:10px;color:#57606a}',
          '.tr-test{margin-top:8px}.tr-test ul{margin:4px 0;padding-left:16px;font-size:12px}',
        ].join('')
        document.head.appendChild(style)
      }
      timeRouterScope = ctx.settingsScope.bind({ namespace: 'time-router' })
      var api = ctx.get('connection').api
      function loadModels() {
        api.llm.models({}).then(function (r) {
          var value = r && r.result && r.result.ok ? r.result.value : null
          if (value && Array.isArray(value.groups)) modelDirectory.groups = value.groups
        }).catch(function () { /* 目录加载失败：下拉为空，稍后可重试 */ })
      }
      loadModels()
      try {
        ctx.remote.$on('llm/adapters-updated', function () { loadModels() })
      } catch (e) { /* 事件面缺失时依赖手动刷新 */ }
      ctx.on('connection/reset', function () { loadModels() })
      ctx.slots.inject('conversation.session.header.actions', function () {
        return ctx.slots.register({ name: 'conversation.session.header.actions', id: 'time-router', order: 10, locale: NS }, StatusBadge)
      })
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register({
          name: 'settings.section',
          id: 'time-router',
          order: 50,
          label: '智能路由',
          locale: NS,
          inject: function () { return { refreshModels: loadModels } },
        }, StatusPage)
      })
    }

    return module.exports
  },
})
