import { useState, useRef, useEffect } from 'react'

const DE = window.deftron || {
  isElectron:false, platform:async()=>'darwin',
  openExternal:async(u)=>window.open(u,'_blank'), notify:async()=>{},
  runCommand:async()=>({pid:-1}), killCommand:async()=>{},
  checkInstalled:async()=>({installed:false}),
  runQuick:async()=>({code:-1,stdout:'',stderr:''}), onOutput:()=>()=>{},
  pingAgent:async(u)=>{try{const r=await fetch(u);return{ok:r.ok}}catch{return{ok:false}}},
  loadSettings:async()=>null, saveSettings:async()=>{},
  saveFile:async(n,c)=>{const a=document.createElement('a');a.href='data:text/plain,'+encodeURIComponent(c);a.download=n;a.click();return{ok:true}},
  openTerminal:async(script,filename)=>({success:false}),
  createTerm:async()=>({ok:false}), writeTerm:async()=>({ok:false}), killTerm:async()=>({ok:true}), subscribeTerm:()=>()=>{},
  spawnAgent:async()=>({ok:false,error:'Not in Electron'}), messageAgent:async()=>({ok:false,response:''}),
  agentStatus:async()=>({running:false}), killAgent:async()=>({ok:true}),
  sshRun:async()=>({ok:false}), sshTest:async()=>({ok:false}),
  httpAgent:async()=>({ok:false}), listSshKeys:async()=>({keys:[]}),
  callAnthropic:async(k,b)=>{const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':k,'anthropic-version':'2023-06-01'},body:JSON.stringify(b)});const d=await r.json();return{ok:!d.error,data:d,error:d.error?.message}},
  apiPost:async(url,hdrs,body)=>{const r=await fetch(url,{method:'POST',headers:{...hdrs,'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();return{ok:r.ok,data:d}},
  onMenu:()=>{},
}

const uid = () => Math.random().toString(36).slice(2)

// Agent backend types
const BACKENDS = {
  claude_api:  { label:'Claude API',   color:'#D4A853', icon:'🤖', desc:'Claude model with custom persona' },
  local_cli:   { label:'Local CLI',    color:'#22C55E', icon:'⌨️',  desc:'Real openclaw / hermes running on this machine' },
  local_http:  { label:'Local HTTP',   color:'#4A9EE8', icon:'🔌', desc:'Ollama, LM Studio, or any local API' },
  remote_ssh:  { label:'Remote SSH',   color:'#A855F7', icon:'🌐', desc:'Agent running on a remote machine via SSH' },
  remote_http: { label:'Remote HTTP',  color:'#FF6B35', icon:'☁️', desc:'Agent HTTP endpoint on another machine' },
}

const THEMES = [
  {id:'gold',c1:'#D4A853',bg:'#070711'},{id:'ember',c1:'#FF6B35',bg:'#0a0703'},
  {id:'arctic',c1:'#4A9EE8',bg:'#06070f'},{id:'void',c1:'#9B59B6',bg:'#080610'},
  {id:'matrix',c1:'#00FF41',bg:'#020a02'},
]

// ─── Embedded Terminal ────────────────────────────────────────────────────────
function Terminal({ agent, onClose, onReady }) {
  const termId  = `term-${agent.id}`
  const bodyRef = useRef(null)
  const [buf, setBuf]       = useState('')
  const [input, setInput]   = useState('')
  const [status, setStatus] = useState('starting')
  const ac = agent.color || '#22C55E'

  useEffect(() => {
    const cmd = agent.cliCommand || (agent.agentRole === 'hermes' ? 'hermes' : 'openclaw')
    setBuf(`▶ Starting ${agent.name} (${cmd})…\n`)
    DE.createTerm(termId, cmd).then(r => {
      if (!r.ok) { setBuf(p=>p+`\n✗ ${r.error||'Could not start — is it installed?'}\n`); setStatus('error'); return }
      setStatus('running')
      onReady?.()
      const unsub = DE.subscribeTerm(termId, data => {
        const clean = data.replace(/\x1b\[[0-9;]*[mGKHFABCDsuJA-Za-z]/g,'').replace(/\r/g,'')
        setBuf(p => (p+clean).slice(-8000))
      })
      return () => unsub()
    })
    return () => DE.killTerm(termId)
  }, [])

  useEffect(() => { bodyRef.current?.scrollTo(0, bodyRef.current.scrollHeight) }, [buf])

  const send = txt => { DE.writeTerm(termId, txt+'\n'); setInput('') }

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',background:'#010108',fontFamily:"'JetBrains Mono',monospace"}}>
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'5px 12px',background:'#0a0a18',borderBottom:`1px solid ${ac}22`,flexShrink:0}}>
        <span>{agent.emoji||'🖥'}</span>
        <span style={{fontSize:11,fontWeight:700,color:ac,letterSpacing:'0.1em'}}>{agent.name.toUpperCase()}</span>
        <div style={{width:5,height:5,borderRadius:'50%',background:status==='running'?'#22C55E':status==='error'?'#EF4444':'#888',marginLeft:4,boxShadow:status==='running'?'0 0 6px #22C55E':'none'}}/>
        <span style={{fontSize:9,color:'#444',flex:1}}>{status}</span>
        <button onClick={onClose} style={{background:'none',border:'none',color:'#333',cursor:'pointer',fontSize:13}}>✕</button>
      </div>
      <div ref={bodyRef} style={{flex:1,overflow:'auto',padding:'8px 12px',fontSize:11,lineHeight:1.65,color:'#88ff88',whiteSpace:'pre-wrap',wordBreak:'break-all'}}>
        {buf}
        {status==='running'&&<span style={{display:'inline-block',width:7,height:12,background:ac,verticalAlign:'text-bottom',animation:'blink 1s step-end infinite'}}/>}
      </div>
      <div style={{display:'flex',borderTop:`1px solid ${ac}18`,flexShrink:0}}>
        <span style={{padding:'8px 10px',color:`${ac}55`,flexShrink:0}}>❯</span>
        <input value={input} onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter')send(input);if(e.key==='c'&&e.ctrlKey)DE.writeTerm(termId,'\x03')}}
          placeholder={status==='running'?`Talk to ${agent.name}…`:'(not running)'}
          disabled={status!=='running'}
          style={{flex:1,background:'transparent',border:'none',color:'#88ff88',padding:'8px 4px',fontSize:11,outline:'none'}} autoFocus/>
      </div>
    </div>
  )
}

// ─── Install Wizard (opens real Terminal.app) ───────────────────────────────
function InstallWizard({ agentRole, onDone, onCancel, accent }) {
  const [launched, setLaunched] = useState(false)
  const [launching, setLaunching] = useState(false)
  const ac = accent || '#D4A853'
  const isHermes = agentRole === 'hermes'

  const HERMES_SCRIPT = [
    '#!/bin/bash',
    'export NVM_DIR="$HOME/.nvm"',
    '[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"',
    'export PATH="$HOME/.hermes/bin:$HOME/.local/bin:$PATH"',
    'clear',
    'echo ""',
    'echo "☤ HERMES SETUP — via DEFTRON"',
    'echo "=============================="',
    'echo ""',
    'if ! command -v hermes &>/dev/null; then',
    '  echo "Installing Hermes..."',
    '  curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash',
    '  source ~/.zshrc 2>/dev/null || source ~/.bashrc 2>/dev/null || true',
    'fi',
    'echo ""',
    'echo "Running hermes setup wizard..."',
    'echo "(Answer the questions, then go back to DEFTRON and click DONE)"',
    'echo ""',
    'hermes setup',
    'echo ""',
    'echo "✓ Setup complete! Go back to DEFTRON and click SETUP DONE."',
    'echo ""',
    'read -p "Press Enter to close this window..."',
  ].join('\n')

  const OPENCLAW_SCRIPT = [
    '#!/bin/bash',
    'export NVM_DIR="$HOME/.nvm"',
    '[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"',
    'clear',
    'echo ""',
    'echo "🦞 OPENCLAW SETUP — via DEFTRON"',
    'echo "================================="',
    'echo ""',
    'OC=""',
    '[ -z "$OC" ] && OC=$(command -v openclaw 2>/dev/null)',
    '[ -z "$OC" ] && OC=$(find "$HOME/.nvm/versions/node" -name "openclaw" 2>/dev/null | grep "/bin/openclaw" | head -1)',
    '[ -z "$OC" ] && OC=$(find "$HOME/.nvm" -name "openclaw" 2>/dev/null | grep "/bin/openclaw" | head -1)',
    '[ -z "$OC" ] && OC="$(npm prefix -g 2>/dev/null)/bin/openclaw"',
    '[ ! -f "$OC" ] && OC=""',
    'if [ -n "$OC" ]; then',
    '  echo "✓ Found: $OC"',
    '  echo ""',
    'else',
    '  echo "Not found in PATH — installing..."',
    '  npm install -g openclaw',
    '  source "$NVM_DIR/nvm.sh" 2>/dev/null',
    '  OC=$(command -v openclaw 2>/dev/null)',
    '  [ -z "$OC" ] && OC=$(find "$HOME/.nvm/versions/node" -name "openclaw" 2>/dev/null | grep "/bin/openclaw" | head -1)',
    '  [ -z "$OC" ] && OC=$(npm prefix -g)/bin/openclaw',
    '  [ ! -f "$OC" ] && OC=""',
    'fi',
    'if [ -z "$OC" ]; then',
    '  echo "ERROR: could not find openclaw. Open a new Terminal and run: openclaw onboard"',
    '  read -p "Press Enter to close..."',
    '  exit 1',
    'fi',
    'echo "Choose any AI provider: Anthropic, OpenRouter, Groq, Ollama, etc."',
    'echo ""',
    '"$OC" onboard',
    'echo ""',
    'echo "✓ Done! Go back to DEFTRON and click SETUP DONE."',
    'read -p "Press Enter to close this window..."',
  ].join('\n')

  const launch = async () => {
    setLaunching(true)
    const script = isHermes ? HERMES_SCRIPT : OPENCLAW_SCRIPT
    const filename = isHermes ? 'setup-hermes' : 'setup-openclaw'
    await DE.openTerminal(script, filename)
    setLaunched(true)
    setLaunching(false)
  }

  return (
    <div style={{position:'fixed',inset:0,background:'#00000099',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300}}>
      <div style={{width:520,background:'#0a0a18',border:`1px solid ${ac}44`,borderRadius:16,overflow:'hidden'}}>
        {/* Header */}
        <div style={{padding:'18px 22px',borderBottom:`1px solid ${ac}22`,display:'flex',alignItems:'center',gap:12}}>
          <span style={{fontSize:24}}>{isHermes ? '☤' : '🦞'}</span>
          <div>
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:16,fontWeight:700,letterSpacing:'0.15em',color:ac}}>
              SET UP {isHermes ? 'HERMES' : 'OPENCLAW'}
            </div>
            <div style={{fontFamily:'sans-serif',fontSize:11,color:'#555',marginTop:2}}>
              Opens Terminal.app to run the real setup wizard
            </div>
          </div>
        </div>

        {/* Steps */}
        <div style={{padding:'22px'}}>
          {[
            {n:1, title:'Open setup terminal', desc:`Click the button below — Terminal.app will open and run the ${isHermes?'Hermes':'OpenClaw'} setup wizard.`},
            {n:2, title:'Follow the prompts', desc:isHermes
              ? 'Pick your AI provider (Anthropic, OpenRouter, Nous Portal, etc.), enter your API key, configure preferences.'
              : 'Pick your AI provider — Anthropic, OpenRouter, Groq, Ollama, and more are all supported. Follow the onboarding steps.'},
            {n:3, title:'Come back here', desc:'When setup finishes, click "SETUP DONE" below to add the agent to DEFTRON.'},
          ].map(step => (
            <div key={step.n} style={{display:'flex',gap:14,marginBottom:16}}>
              <div style={{width:26,height:26,borderRadius:'50%',background:launched&&step.n===1?'#22C55E22':step.n===1?`${ac}22`:'#0e0e1c',border:`1px solid ${launched&&step.n===1?'#22C55E44':step.n===1?ac+'44':'#ffffff12'}`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,fontWeight:700,color:launched&&step.n===1?'#22C55E':step.n===1?ac:'#555',flexShrink:0}}>
                {launched&&step.n===1?'✓':step.n}
              </div>
              <div>
                <div style={{fontFamily:'sans-serif',fontSize:13,fontWeight:700,color:step.n===1?(launched?'#22C55E':ac):'#888',marginBottom:3}}>{step.title}</div>
                <div style={{fontFamily:'sans-serif',fontSize:12,color:'#555',lineHeight:1.6}}>{step.desc}</div>
              </div>
            </div>
          ))}

          {/* Tip */}
          <div style={{background:'#0e0e1c',borderRadius:8,padding:'10px 14px',marginBottom:18}}>
            <div style={{fontFamily:'sans-serif',fontSize:11,color:'#555',lineHeight:1.7}}>
              {isHermes
                ? '💡 When Hermes asks for an AI provider, choose Anthropic and paste your Anthropic key. After setup, run `hermes` in Terminal to start chatting.'
                : '💡 When OpenClaw asks for an API key, use your Anthropic key (sk-ant-api03-…). After setup, run `openclaw` in Terminal to start chatting.'}
            </div>
          </div>

          {/* Launch button */}
          {!launched ? (
            <button onClick={launch} disabled={launching}
              style={{width:'100%',padding:'13px',background:`linear-gradient(135deg,${ac},${ac}88)`,border:'none',color:'#07070f',borderRadius:10,cursor:launching?'default':'pointer',fontFamily:"'Barlow Condensed',sans-serif",fontSize:14,fontWeight:700,letterSpacing:'0.12em',marginBottom:10}}>
              {launching ? 'OPENING TERMINAL…' : `⊞ OPEN SETUP TERMINAL FOR ${isHermes?'HERMES':'OPENCLAW'}`}
            </button>
          ) : (
            <div style={{background:'#0a1a0a',border:'1px solid #22C55E33',borderRadius:8,padding:'10px 14px',textAlign:'center',marginBottom:10}}>
              <div style={{fontFamily:'sans-serif',fontSize:12,color:'#22C55E',marginBottom:3}}>✓ Terminal.app is open</div>
              <div style={{fontFamily:'sans-serif',fontSize:11,color:'#555'}}>Complete the setup in Terminal, then click DONE below</div>
            </div>
          )}
        </div>

        <div style={{display:'flex',gap:10,padding:'0 22px 18px'}}>
          <button onClick={onCancel} style={{flex:1,padding:'10px',background:'#0a0a18',border:'1px solid #ffffff18',color:'#666',borderRadius:8,cursor:'pointer',fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:700}}>CANCEL</button>
          <button onClick={onDone} disabled={!launched}
            style={{flex:2,padding:'10px',background:launched?`linear-gradient(135deg,${ac},${ac}88)`:'#1a1a2e',border:'none',color:launched?'#07070f':'#333',borderRadius:8,cursor:launched?'pointer':'default',fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:700,letterSpacing:'0.1em'}}>
            {launched ? '✓ SETUP DONE — ADD TO DEFTRON' : 'OPEN TERMINAL FIRST →'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Shared form field components (must be outside wizard to avoid remount) ───
function F({ label, children }) {
  return (
    <div style={{marginBottom:14}}>
      <div style={{fontFamily:'sans-serif',fontSize:11,color:'#666',marginBottom:6,letterSpacing:'0.06em',textTransform:'uppercase'}}>{label}</div>
      {children}
    </div>
  )
}

function FieldInput({ val, set, ph, type='text', accentColor }) {
  return (
    <input type={type} value={val} onChange={e=>set(e.target.value)} placeholder={ph}
      style={{width:'100%',background:'#060612',border:'1px solid #ffffff18',color:'#e0e0f0',padding:'9px 12px',borderRadius:8,fontFamily:"'JetBrains Mono',monospace",fontSize:11,outline:'none',boxSizing:'border-box'}}
      onFocus={e=>e.target.style.borderColor=accentColor||'#D4A853'}
      onBlur={e=>e.target.style.borderColor='#ffffff18'}/>
  )
}

// ─── Add Agent Wizard ─────────────────────────────────────────────────────────
function AddAgentWizard({ onAdd, onCancel, accent }) {
  const [step, setStep]         = useState(0)
  const [backend, setBackend]   = useState(null)
  const [agentRole, setRole]    = useState('openclaw')
  const [name, setName]         = useState('')
  const [emoji, setEmoji]       = useState('🦞')
  const [color, setColor]       = useState('#22C55E')
  const [cliCmd, setCliCmd]     = useState('')
  const [httpUrl, setHttpUrl]   = useState('')
  const [httpKey, setHttpKey]   = useState('')
  const [sshHost, setSshHost]   = useState('')
  const [sshPort, setSshPort]   = useState('22')
  const [sshUser, setSshUser]   = useState('')
  const [sshKey, setSshKey]     = useState('')
  const [sshCmd, setSshCmd]     = useState('')
  const [sshKeys, setSshKeys]   = useState([])
  const [testing, setTesting]   = useState(false)
  const [testResult, setTest]   = useState(null)
  const [agentTask, setAgentTask]   = useState('')
  const [showInstall, setShowInstall] = useState(false)
  const ac = accent || '#D4A853'

  useEffect(() => { DE.listSshKeys().then(r=>setSshKeys(r.keys||[])) }, [])
  const DEFAULTS = { openclaw:{emoji:'🦞',color:'#D4A853',name:'ClawBot',cli:'openclaw'}, hermes:{emoji:'☤',color:'#00C8B8',name:'Hermes',cli:'hermes'}, custom:{emoji:'🤖',color:'#4A9EE8',name:'',cli:''} }
  const prevRole = useRef(agentRole)
  useEffect(() => {
    const prev = DEFAULTS[prevRole.current]
    const next = DEFAULTS[agentRole]
    if (!next) return
    setEmoji(next.emoji)
    setColor(next.color)
    // Only reset name if it's empty or was the previous role's default
    if (!name || name === prev?.name) setName(next.name)
    setCliCmd(next.cli)
    setSshCmd(next.cli)
    prevRole.current = agentRole
  }, [agentRole])

  const testConn = async () => {
    setTesting(true); setTest(null)
    if (backend==='remote_ssh') {
      const r = await DE.sshTest({host:sshHost,port:parseInt(sshPort)||22,user:sshUser,keyPath:sshKey||undefined})
      setTest(r.ok?`✓ SSH OK — connected to ${sshUser}@${sshHost}`:`✗ ${r.error||'Failed'}`)
    } else {
      const r = await DE.pingAgent(httpUrl)
      setTest(r.ok?`✓ Reachable at ${httpUrl}`:`✗ Cannot reach ${httpUrl}`)
    }
    setTesting(false)
  }

  const finish = () => {
    const agent = {
      id:uid(), name:name||'Agent', emoji, color,
      backend, agentRole, isPrimary:false,
      model:'claude-sonnet-4-20250514',
      specialization: agentRole==='hermes'?'research, analysis, competitive intelligence':agentRole==='openclaw'?'personal tasks, execution, creative work':agentTask||'general assistant',
      agentTask: agentTask||'',
      enabled: true,
    }
    if (backend==='local_cli')   { agent.cliCommand=cliCmd; agent.connection=cliCmd }
    if (backend==='local_http')  { agent.httpUrl=httpUrl; agent.httpKey=httpKey; agent.connection=httpUrl }
    if (backend==='remote_ssh')  { agent.ssh={host:sshHost,port:sshPort,user:sshUser,keyPath:sshKey,command:sshCmd}; agent.connection=`${sshUser}@${sshHost}` }
    if (backend==='remote_http') { agent.httpUrl=httpUrl; agent.httpKey=httpKey; agent.connection=httpUrl }
    if (backend==='claude_api')  { agent.connection='Claude API' }
    onAdd(agent)
  }


  return (<>
    {showInstall && (
      <InstallWizard agentRole={agentRole} accent={color}
        onDone={()=>{setShowInstall(false)}}
        onCancel={()=>setShowInstall(false)}/>
    )}
    <div style={{position:'fixed',inset:0,background:'#00000088',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200}}>
      <div style={{background:'#0e0e1c',border:`1px solid ${color}44`,borderRadius:20,padding:28,width:500,maxHeight:'88vh',overflowY:'auto'}}>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:18,fontWeight:700,letterSpacing:'0.15em',color,marginBottom:20}}>
          {step===0?'ADD AGENT':'CONFIGURE AGENT'}
        </div>

        {step===0&&(<>
          {/* Role */}
          <F label="Agent type">
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
              {[['openclaw','🦞','OpenClaw','Personal AI\nmemory & tools'],['hermes','☤','Hermes','Research &\nanalysis'],['custom','🤖','Custom','Any agent\nor model']].map(([r,e,l,d])=>(
                <button key={r} onClick={()=>setRole(r)}
                  style={{padding:'12px 8px',background:agentRole===r?`${color}18`:'#060612',border:`1px solid ${agentRole===r?color+'66':'#ffffff12'}`,borderRadius:10,cursor:'pointer',textAlign:'center'}}>
                  <div style={{fontSize:22,marginBottom:4}}>{e}</div>
                  <div style={{fontFamily:'sans-serif',fontSize:12,fontWeight:700,color:agentRole===r?color:'#aaa'}}>{l}</div>
                  <div style={{fontFamily:'sans-serif',fontSize:10,color:'#444',marginTop:2,whiteSpace:'pre-line'}}>{d}</div>
                </button>
              ))}
            </div>
          </F>

          {/* Backend */}
          <F label="Where does it run?">
            {Object.entries(BACKENDS).map(([k,t])=>(
              <button key={k} onClick={()=>setBackend(k)}
                style={{display:'flex',alignItems:'center',gap:12,width:'100%',padding:'10px 14px',marginBottom:6,background:backend===k?`${color}18`:'#060612',border:`1px solid ${backend===k?color+'66':'#ffffff12'}`,borderRadius:10,cursor:'pointer',textAlign:'left'}}>
                <span style={{fontSize:18,flexShrink:0}}>{t.icon}</span>
                <div style={{flex:1}}>
                  <div style={{fontFamily:'sans-serif',fontSize:12,fontWeight:700,color:backend===k?color:'#ccc'}}>{t.label}</div>
                  <div style={{fontFamily:'sans-serif',fontSize:10,color:'#444'}}>{t.desc}</div>
                </div>
                {backend===k&&<div style={{width:7,height:7,borderRadius:'50%',background:color,flexShrink:0}}/>}
              </button>
            ))}
          </F>

          {/* Quick install for real agents */}
          {(agentRole==='openclaw'||agentRole==='hermes')&&backend==='local_cli'&&(
            <div style={{background:`${color}0f`,border:`1px solid ${color}33`,borderRadius:10,padding:'12px 14px',marginBottom:14}}>
              <div style={{fontFamily:'sans-serif',fontSize:12,fontWeight:700,color,marginBottom:6}}>
                🚀 Run setup wizard in terminal
              </div>
              <div style={{fontFamily:'sans-serif',fontSize:11,color:'#888',lineHeight:1.6,marginBottom:10}}>
                {agentRole==='openclaw'?'Installs openclaw and runs the setup wizard. You can choose any AI provider — Anthropic, OpenRouter, Groq, Ollama, and more.':'Installs Hermes and runs the setup wizard. Choose any AI provider — Anthropic, OpenRouter, Nous Portal, and more.'}
              </div>
              <button onClick={()=>setShowInstall(true)}
                style={{width:'100%',padding:'9px',background:`${color}22`,border:`1px solid ${color}55`,color,borderRadius:8,cursor:'pointer',fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,fontWeight:700,letterSpacing:'0.1em'}}>
                ⊞ OPEN SETUP TERMINAL
              </button>
            </div>
          )}

          <div style={{display:'flex',gap:10,marginTop:8}}>
            <button onClick={onCancel} style={{flex:1,padding:'11px',background:'#0a0a18',border:'1px solid #ffffff18',color:'#666',borderRadius:10,cursor:'pointer',fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:700}}>CANCEL</button>
            <button onClick={()=>backend&&setStep(1)} disabled={!backend}
              style={{flex:2,padding:'11px',background:backend?`linear-gradient(135deg,${color},${color}88)`:'#1a1a2e',border:'none',color:backend?'#07070f':'#333',borderRadius:10,cursor:backend?'pointer':'default',fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:700,letterSpacing:'0.1em'}}>
              CONFIGURE →
            </button>
          </div>
        </>)}

        {step===1&&(<>
          <F label="Name & appearance">
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <input value={emoji} onChange={e=>setEmoji(e.target.value)}
                style={{width:52,height:40,background:'#060612',border:'1px solid #ffffff18',color:'#e0e0f0',padding:'4px',borderRadius:8,fontSize:22,textAlign:'center',outline:'none',flexShrink:0}}/>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                onFocus={e=>e.target.style.borderColor=color}
                onBlur={e=>e.target.style.borderColor='#ffffff18'}
                placeholder="Give your agent a name…"
                autoComplete="off"
                style={{flex:1,height:40,background:'#060612',border:'1px solid #ffffff18',color:'#e0e0f0',padding:'0 12px',borderRadius:8,fontFamily:'sans-serif',fontSize:14,outline:'none'}}/>
              <input type="color" value={color} onChange={e=>setColor(e.target.value)}
                style={{width:40,height:40,border:'none',background:'none',cursor:'pointer',padding:0,borderRadius:8,flexShrink:0}}/>
            </div>
          </F>

          {agentRole==='custom'&&(
            <F label="What does this agent do? (task / purpose)">
              <textarea
                value={agentTask}
                onChange={e => setAgentTask(e.target.value)}
                onFocus={e=>e.target.style.borderColor=color}
                onBlur={e=>e.target.style.borderColor='#ffffff18'}
                rows={4}
                placeholder="Describe what this agent does — e.g. 'Monitor my GitHub repos for issues', 'Write video scripts in my style', 'Handle customer support emails'"
                style={{width:'100%',background:'#060612',border:'1px solid #ffffff18',color:'#e0e0f0',padding:'10px 12px',borderRadius:8,fontFamily:'sans-serif',fontSize:13,resize:'vertical',outline:'none',lineHeight:1.6,boxSizing:'border-box'}}/>
              <div style={{fontFamily:'sans-serif',fontSize:10,color:'#444',marginTop:5}}>This becomes the agent's system prompt focus. Be specific.</div>
            </F>
          )}
          {backend==='local_cli'&&(
            <F label="CLI command">
              <FieldInput val={cliCmd} set={setCliCmd} ph="openclaw or hermes or my-agent-cli" accentColor={color}/>
              <div style={{fontFamily:'sans-serif',fontSize:10,color:'#444',marginTop:5}}>💡 nvm is loaded automatically. Binary name is enough.</div>
              {(agentRole==='openclaw'||agentRole==='hermes')&&(
                <button onClick={()=>setShowInstall(true)} style={{marginTop:8,width:'100%',padding:'8px',background:`${color}18`,border:`1px solid ${color}44`,color,borderRadius:7,cursor:'pointer',fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,fontWeight:700,letterSpacing:'0.1em'}}>
                  ⊞ RUN SETUP WIZARD IN TERMINAL
                </button>
              )}
            </F>
          )}

          {(backend==='local_http'||backend==='remote_http')&&(<>
            <F label="HTTP endpoint"><FieldInput val={httpUrl} set={setHttpUrl} ph="http://192.168.1.100:11434" accentColor={color}/></F>
            <F label="API key (optional)"><FieldInput val={httpKey} set={setHttpKey} ph="sk-…" type="password" accentColor={color}/></F>
          </>)}

          {backend==='remote_ssh'&&(<>
            <F label="Remote host">
              <div style={{display:'flex',gap:8}}>
                <FieldInput val={sshHost} set={setSshHost} ph="hostname or IP" accentColor={color}/>
                <input value={sshPort} onChange={e=>setSshPort(e.target.value)} style={{width:64,background:'#060612',border:'1px solid #ffffff18',color:'#e0e0f0',padding:'9px',borderRadius:8,fontFamily:"'JetBrains Mono',monospace",fontSize:11,textAlign:'center',outline:'none'}}/>
              </div>
            </F>
            <F label="Username"><FieldInput val={sshUser} set={setSshUser} ph="ubuntu or your username" accentColor={color}/></F>
            <F label="SSH key">
              <select value={sshKey} onChange={e=>setSshKey(e.target.value)} style={{width:'100%',background:'#060612',border:'1px solid #ffffff18',color:sshKey?'#e0e0f0':'#555',padding:'9px 12px',borderRadius:8,fontFamily:"'JetBrains Mono',monospace",fontSize:11,outline:'none',appearance:'none'}}>
                <option value="">Default (~/.ssh/id_rsa)</option>
                {sshKeys.map(k=><option key={k} value={k}>{k.split('/').pop()}</option>)}
              </select>
            </F>
            <F label="Command on remote"><FieldInput val={sshCmd} set={setSshCmd} ph="openclaw or hermes or ~/start.sh" accentColor={color}/></F>
            <button onClick={testConn} disabled={testing||!sshHost||!sshUser}
              style={{width:'100%',padding:'9px',background:'#0a0a18',border:`1px solid ${color}44`,color,borderRadius:8,cursor:'pointer',fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,fontWeight:700,marginBottom:8}}>
              {testing?'TESTING…':'⚡ TEST SSH CONNECTION'}
            </button>
            {testResult&&<div style={{fontFamily:'sans-serif',fontSize:11,color:testResult.startsWith('✓')?'#22C55E':'#EF4444',marginBottom:10,padding:'7px 10px',background:'#060612',borderRadius:6}}>{testResult}</div>}
          </>)}

          <div style={{display:'flex',gap:10,marginTop:8}}>
            <button onClick={()=>setStep(0)} style={{flex:1,padding:'11px',background:'#0a0a18',border:'1px solid #ffffff18',color:'#666',borderRadius:10,cursor:'pointer',fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:700}}>← BACK</button>
            <button onClick={finish} disabled={!name}
              style={{flex:2,padding:'11px',background:`linear-gradient(135deg,${color},${color}88)`,border:'none',color:'#07070f',borderRadius:10,cursor:'pointer',fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:700,letterSpacing:'0.1em'}}>
              ADD {(name||'AGENT').toUpperCase()} →
            </button>
          </div>
        </>)}
      </div>
    </div>
  </>)
}

// ─── Message Bubble ───────────────────────────────────────────────────────────
function Bubble({ msg, agents, accent }) {
  const md = t => t
    .replace(/^#{1,3}\s+(.+)$/gm,(_,h)=>`<div style="font-weight:700;color:#fff;font-size:15px;margin:12px 0 5px">${h}</div>`)
    .replace(/\*\*(.*?)\*\*/g,'<strong style="color:#fff">$1</strong>')
    .replace(/`([^`]+)`/g,`<code style="background:#1a1a2e;padding:2px 6px;border-radius:4px;font-family:'JetBrains Mono',monospace;font-size:.88em;color:#D4A853">$1</code>`)
    .replace(/^[-•]\s+(.+)$/gm,'<div style="padding-left:14px;margin:2px 0">· $1</div>')
    .replace(/\n\n/g,"<div style='height:8px'></div>").replace(/\n/g,'<br/>')

  if (msg.role==='system-info') return (
    <div style={{textAlign:'center',padding:'2px 0'}}>
      <span style={{fontFamily:'sans-serif',fontSize:11,color:'#333',padding:'3px 12px',background:'#0d0d1a',border:'1px solid #ffffff08',borderRadius:5,display:'inline-block'}}>{msg.content}</span>
    </div>
  )
  if (msg.role==='routing') return (
    <div style={{display:'flex',alignItems:'center',gap:10,padding:'2px 0'}}>
      <div style={{flex:1,height:1,background:`linear-gradient(90deg,${accent}44,transparent)`}}/>
      <span style={{fontFamily:'sans-serif',fontSize:11,color:'#444',padding:'2px 10px',background:'#0d0d1a',border:'1px solid #ffffff08',borderRadius:5}}>→ {msg.target}</span>
      <div style={{flex:1,height:1,background:`linear-gradient(90deg,transparent,${msg.color||accent}44)`}}/>
    </div>
  )
  if (msg.role==='error') return (
    <div style={{background:'#1a0808',border:'1px solid #EF444433',borderLeft:'3px solid #EF4444',borderRadius:'0 10px 10px 10px',padding:'10px 14px',fontFamily:'sans-serif',fontSize:13,color:'#ff8888',lineHeight:1.6}}>⚠️ {msg.content}</div>
  )
  if (msg.role==='user') return (
    <div style={{display:'flex',justifyContent:'flex-end'}}>
      <div style={{maxWidth:'72%',background:'#1a1a2e',borderRadius:'14px 3px 14px 14px',padding:'11px 15px',fontSize:14,lineHeight:1.7,color:'#e0e0f8',fontFamily:'sans-serif'}}>{msg.content}</div>
    </div>
  )
  const ag = agents.find(a=>a.id===msg.agentId)||{}; const c = ag.color||accent
  return (
    <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
      <div style={{width:32,height:32,borderRadius:8,flexShrink:0,background:`linear-gradient(135deg,${c}cc,${c}33)`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:15}}>{ag.emoji||'🤖'}</div>
      <div style={{maxWidth:'82%'}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
          <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,fontWeight:700,letterSpacing:'0.12em',color:c}}>{(ag.name||'DEF').toUpperCase()}</span>
          {ag.backend&&ag.backend!=='claude_api'&&<span style={{fontFamily:'sans-serif',fontSize:9,color:'#333',padding:'1px 5px',background:'#0a0a18',borderRadius:3,border:'1px solid #ffffff08'}}>{BACKENDS[ag.backend]?.label}</span>}
        </div>
        <div style={{background:'#0e0e1c',border:`1px solid ${c}22`,borderRadius:'3px 14px 14px 14px',padding:'11px 14px',fontSize:14,lineHeight:1.8,color:'#d8d8f0',fontFamily:'sans-serif'}}
          dangerouslySetInnerHTML={{__html:md(msg.content)}}/>
      </div>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [accent, setAccent]   = useState('#D4A853')
  const [bg, setBg]           = useState('#070711')
  const [onboarded, setOnboarded] = useState(false)
  const [agents, setAgents]   = useState([])
  const [msgs, setMsgs]       = useState([])
  const [input, setInput]     = useState('')
  const [isLoading, setLoading] = useState(false)
  const [status, setStatus]   = useState('')
  const [activeAgentId, setActiveAgentId] = useState(null) // which agent receives messages
  const [runningIds, setRunning] = useState(new Set())
  const [terminals, setTerminals] = useState([]) // open terminal panels
  const [showAdd, setShowAdd] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState('keys')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [openRouterKey, setOrKey]       = useState('')
  const [groqKey, setGroqKey]           = useState('')
  const [whisperKey, setWhisperKey]     = useState('')
  const history = useRef([])
  const endRef  = useRef(null)

  const primary  = agents.find(a=>a.isPrimary)
  const activeAg = agents.find(a=>a.id===activeAgentId)

  useEffect(() => {
    DE.loadSettings().then(s => {
      if (!s) return
      if (s.onboarded) setOnboarded(true)
      if (s.agents?.length) setAgents(s.agents)
      if (s.anthropicKey) setAnthropicKey(s.anthropicKey)
      if (s.openRouterKey) setOrKey(s.openRouterKey)
      if (s.groqKey) setGroqKey(s.groqKey)
      if (s.whisperKey) setWhisperKey(s.whisperKey)
      if (s.accent) setAccent(s.accent)
      if (s.bg) setBg(s.bg)
    })
  }, [])

  useEffect(() => {
    if (!onboarded) return
    DE.saveSettings({ onboarded, agents, anthropicKey, openRouterKey, groqKey, whisperKey, accent, bg })
  }, [agents, anthropicKey, openRouterKey, groqKey, whisperKey, accent, bg])

  useEffect(() => { endRef.current?.scrollIntoView({behavior:'smooth'}) }, [msgs])

  const addMsg = m => setMsgs(p=>[...p,{id:Date.now()+Math.random(),...m}])
  const updateAgent = (id,patch) => setAgents(p=>p.map(a=>a.id===id?{...a,...patch}:a))
  const removeAgent = id => setAgents(p=>p.filter(a=>a.id!==id))

  const callClaude = async (msg, sys, model, hist=[]) => {
    if (!anthropicKey) throw new Error('No Anthropic key — add in Settings → Keys')
    const res = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':anthropicKey,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:model||'claude-sonnet-4-20250514',max_tokens:2048,system:sys,messages:[...hist,{role:'user',content:msg}]})
    })
    const d = await res.json()
    if (d.error) throw new Error(d.error.message)
    return d.content[0].text
  }

  const callAgent = async (agent, task) => {
    // Real local CLI process (openclaw, hermes running in embedded terminal)
    if (agent.backend==='local_cli') {
      if (!runningIds.has(agent.id)) {
        throw new Error(`${agent.name} is not running. Click the agent in the top bar, then hit LAUNCH to start it.`)
      }
      const st = await DE.agentStatus(agent.id)
      if (!st.running) {
        setRunning(p=>{const n=new Set(p);n.delete(agent.id);return n})
        throw new Error(`${agent.name} process stopped. Click LAUNCH to restart it.`)
      }
      const r = await DE.messageAgent(agent.id, task, 30000)
      if (r.ok && r.response) return r.response
      throw new Error(`${agent.name} did not respond. The agent may need input — check its terminal panel.`)
    }
    // Remote SSH
    if (agent.backend==='remote_ssh' && agent.ssh) {
      const r = await DE.sshRun({...agent.ssh,command:`echo "${task.replace(/"/g,"'")}" | ${agent.ssh.command}`,timeout:30})
      if (r.ok) return r.stdout||'(no output from remote agent)'
      throw new Error(`SSH error connecting to ${agent.connection}: ${r.stderr||r.error}`)
    }
    // Local or remote HTTP (Ollama, LM Studio, custom APIs)
    if (agent.backend==='local_http'||agent.backend==='remote_http') {
      const r = await DE.httpAgent({url:agent.httpUrl+'/api/chat',method:'POST',headers:agent.httpKey?{Authorization:`Bearer ${agent.httpKey}`}:{},body:{model:agent.model||'llama3.2',messages:[{role:'user',content:task}]},timeout:30})
      if (r.ok) return r.data?.message?.content||r.data?.response||JSON.stringify(r.data)
      throw new Error(`HTTP agent at ${agent.httpUrl} returned error: ${r.error||r.status}`)
    }
    // Claude API (only DEF uses this — other agents should be real processes)
    if (agent.backend==='claude_api') {
      const sys = agent.agentRole==='hermes'
        ? `You are ${agent.name}, a research and analysis agent.`
        : `You are ${agent.name}, a personal AI assistant.`
      return callClaude(task, sys, agent.model)
    }
    throw new Error(`${agent.name} has no connection configured. Edit the agent to set up its backend.`)
  }

  const defPrompt = () => {
    const others = agents.filter(a=>!a.isPrimary&&a.enabled!==false)
    const team = others.length
      ? '\n\nYOUR TEAM (real agent processes):\n' + others.map(ag => {
          const live = runningIds.has(ag.id)
          const status = live ? '● LIVE' : '○ not running (user must LAUNCH it)'
          const loc = ag.connection || ag.backend || 'local'
          return `• ${ag.name} [${ag.agentRole||'agent'} @ ${loc} · ${status}]: ${ag.specialization||'general'}`
        }).join('\n') +
        '\n\nTo delegate: [DELEGATE:Name:task description]' +
        '\nTo run in parallel: [PARALLEL:Name1,Name2:task]' +
        '\nIMPORTANT: Only delegate to agents that are LIVE. If an agent is not running, tell the user to launch it first.'
      : '\n\nNo agents connected yet. Tell the user to click + ADD to add openclaw or hermes.'
    return `You are DEF, the orchestrator of DEFTRON. You coordinate real AI agent processes running locally or on remote machines.

Be direct and efficient. When the user asks you to do something that another agent specializes in, delegate it. When agents are not running, tell the user clearly and suggest they launch the agent first.${team}`
  }

  const send = async () => {
    if (!input.trim()||isLoading) return
    const text = input.trim(); setInput(''); setLoading(true)
    addMsg({role:'user',content:text})
    history.current = [...history.current,{role:'user',content:text}]

    try {
      // Talking directly to a non-DEF agent
      if (activeAg && !activeAg.isPrimary) {
        setStatus(`${activeAg.name} working…`)
        // If it's a live CLI agent with a terminal open, write to it
        if (activeAg.backend==='local_cli' && terminals.includes(activeAg.id)) {
          DE.writeTerm(`term-${activeAg.id}`, text)
          addMsg({role:'system-info',content:`→ Sent to ${activeAg.name} terminal`})
        } else {
          const resp = await callAgent(activeAg, text)
          addMsg({role:'assistant',agentId:activeAg.id,content:resp})
          history.current = [...history.current,{role:'assistant',content:resp}]
        }
        setLoading(false); setStatus(''); return
      }

      // @mention
      const mention = text.match(/^@([^\s]+)\s+([\s\S]+)/)
      if (mention) {
        const target = agents.find(a=>a.name.toLowerCase()===mention[1].toLowerCase()&&!a.isPrimary)
        if (target) {
          addMsg({role:'routing',target:target.name,color:target.color})
          setStatus(`${target.name} working…`)
          if (target.backend==='local_cli'&&terminals.includes(target.id)) {
            DE.writeTerm(`term-${target.id}`, mention[2])
            addMsg({role:'system-info',content:`→ Sent to ${target.name} terminal`})
          } else {
            const resp = await callAgent(target, mention[2])
            addMsg({role:'assistant',agentId:target.id,content:resp})
            history.current = [...history.current,{role:'assistant',content:resp}]
          }
          setLoading(false); setStatus(''); return
        }
      }

      // DEF orchestrates
      setStatus('DEF thinking…')
      const reply = await callClaude(text, defPrompt(), primary?.model, history.current.slice(0,-1))
      addMsg({role:'assistant',agentId:primary?.id,content:reply})
      history.current = [...history.current,{role:'assistant',content:reply}]

      for (const [,n,task] of [...reply.matchAll(/\[DELEGATE:([^:]+):([^\]]+)\]/g)]) {
        const t = agents.find(a=>a.name.toLowerCase()===n.toLowerCase()&&!a.isPrimary)
        if (t) {
          addMsg({role:'routing',target:t.name,color:t.color})
          setStatus(`${t.name} working…`)
          const resp = await callAgent(t, task.trim())
          addMsg({role:'assistant',agentId:t.id,content:resp})
          history.current = [...history.current,{role:'assistant',content:resp}]
        }
      }

      const parallels = [...reply.matchAll(/\[PARALLEL:([^:]+):([^\]]+)\]/g)]
      for (const [,names,task] of parallels) {
        const targets = names.split(',').map(n=>agents.find(a=>a.name.toLowerCase()===n.trim().toLowerCase()&&!a.isPrimary)).filter(Boolean)
        if (targets.length) {
          setStatus(`Running ${targets.map(t=>t.name).join(' & ')} in parallel…`)
          const results = await Promise.all(targets.map(t=>callAgent(t,task.trim()).catch(e=>`Error: ${e.message}`)))
          targets.forEach((t,i)=>addMsg({role:'assistant',agentId:t.id,content:results[i]}))
        }
      }
    } catch(e) { addMsg({role:'error',content:e.message}) }
    setLoading(false); setStatus('')
  }

  // ── Onboarding ────────────────────────────────────────────────────────────
  if (!onboarded) return (
    <div style={{height:'100vh',background:bg,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:20}}>
      <style>{'@import url("https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;900&family=JetBrains+Mono:wght@400&display=swap")'}</style>
      <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:72,fontWeight:900,letterSpacing:'0.15em',color:accent}}>DEFTRON</div>
      <div style={{fontFamily:'sans-serif',fontSize:14,color:'#444',textAlign:'center',maxWidth:380,lineHeight:1.7}}>Multi-agent command center. Run openclaw, hermes, and any AI agent — local or remote.</div>
      <div style={{display:'flex',flexDirection:'column',gap:8,width:360}}>
        <div style={{fontFamily:'sans-serif',fontSize:12,color:'#555'}}>Anthropic API key</div>
        <input type="password" value={anthropicKey} onChange={e=>setAnthropicKey(e.target.value)} placeholder="sk-ant-api03-…"
          style={{background:'#0a0a18',border:`1px solid ${accent}44`,color:'#e0e0f0',padding:'11px 14px',borderRadius:10,fontFamily:"'JetBrains Mono',monospace",fontSize:12,outline:'none'}}/>
      </div>
      <button onClick={()=>{
        const def={id:'def-primary',name:'DEF',emoji:'🤖',color:accent,isPrimary:true,model:'claude-sonnet-4-20250514',backend:'claude_api',connection:'Anthropic API',enabled:true}
        setAgents([def])
        setMsgs([{id:uid(),role:'assistant',agentId:'def-primary',content:"What's good. I'm DEF — your command center.\n\nAdd real agents using the **+ ADD** button above. You can connect:\n- **OpenClaw** or **Hermes** on this machine (installs & configures in a terminal right here)\n- **Remote agents** on other machines via SSH or HTTP\n- **Local AI** via Ollama or any HTTP API\n\nWhat do you need?"}])
        setOnboarded(true)
      }} style={{padding:'13px 40px',background:`linear-gradient(135deg,${accent},${accent}88)`,border:'none',color:'#07070f',borderRadius:12,cursor:'pointer',fontFamily:"'Barlow Condensed',sans-serif",fontSize:16,fontWeight:700,letterSpacing:'0.15em'}}>
        LAUNCH DEFTRON →
      </button>
      <button onClick={()=>setAnthropicKey('demo')} style={{background:'none',border:'none',color:'#333',cursor:'pointer',fontFamily:'sans-serif',fontSize:12}}>Skip</button>
    </div>
  )

  const termHeight = terminals.length > 0 ? 300 : 0

  return (
    <div style={{height:'100vh',background:bg,display:'flex',flexDirection:'column',color:'#e0e0f0',overflow:'hidden'}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;900&family=JetBrains+Mono:wght@400;600&display=swap');
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:3px;height:3px} ::-webkit-scrollbar-thumb{background:#ffffff18;border-radius:2px}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
        @keyframes pulse{0%,100%{opacity:.5}50%{opacity:1}}
      `}</style>

      {/* ── TOP BAR ── */}
      <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 16px',borderBottom:'1px solid #ffffff08',background:`${bg}ee`,flexShrink:0,WebkitAppRegion:'drag'}}>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:20,fontWeight:900,letterSpacing:'0.2em',color:accent,WebkitAppRegion:'no-drag',flexShrink:0}}>DEFTRON</div>

        {/* ── AGENT SELECTOR ── */}
        <div style={{display:'flex',gap:4,flex:1,alignItems:'center',WebkitAppRegion:'no-drag',overflowX:'auto',padding:'0 4px'}}>
          {agents.map(ag=>{
            const isActive = ag.isPrimary ? activeAgentId===null : activeAgentId===ag.id
            const isRunning = runningIds.has(ag.id)||ag.isPrimary
            const isDisabled = ag.enabled===false
            return (
              <button key={ag.id}
                onClick={()=>setActiveAgentId(ag.isPrimary?null:(activeAgentId===ag.id?null:ag.id))}
                title={`${ag.name} — click to talk directly`}
                style={{
                  display:'flex',alignItems:'center',gap:6,padding:'5px 10px',
                  background:isActive?`${ag.color||accent}22`:isDisabled?'#0a0a0a':'#0e0e1c',
                  border:`1px solid ${isActive?(ag.color||accent)+'66':isDisabled?'#1a1a1a':'#ffffff12'}`,
                  borderRadius:8,cursor:'pointer',flexShrink:0,
                  opacity:isDisabled?0.35:1,
                  transition:'all .2s',
                  boxShadow:isActive?`0 0 10px ${ag.color||accent}33`:'none',
                }}>
                <span style={{fontSize:13}}>{ag.emoji||'🤖'}</span>
                <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,fontWeight:700,letterSpacing:'0.1em',color:isActive?(ag.color||accent):'#666'}}>{ag.name.toUpperCase()}</span>
                {/* Status dot */}
                <div style={{width:5,height:5,borderRadius:'50%',background:isDisabled?'#222':isRunning?'#22C55E':'#333',flexShrink:0,boxShadow:isRunning&&!isDisabled?'0 0 5px #22C55E':'none'}}/>
                {/* Enable/disable toggle for non-primary */}
                {!ag.isPrimary&&(
                  <div onClick={e=>{e.stopPropagation();updateAgent(ag.id,{enabled:ag.enabled===false})}}
                    style={{width:12,height:12,borderRadius:2,background:isDisabled?'#333':ag.color||accent,flexShrink:0,cursor:'pointer',opacity:0.8,marginLeft:2}} title={isDisabled?'Enable agent':'Disable agent'}/>
                )}
              </button>
            )
          })}
          <button onClick={()=>setShowAdd(true)}
            style={{padding:'5px 10px',background:'none',border:`1px dashed ${accent}33`,color:`${accent}55`,borderRadius:8,cursor:'pointer',fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,fontWeight:700,letterSpacing:'0.1em',flexShrink:0,transition:'all .2s',WebkitAppRegion:'no-drag'}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor=accent;e.currentTarget.style.color=accent}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor=`${accent}33`;e.currentTarget.style.color=`${accent}55`}}>
            + ADD
          </button>
        </div>

        <button onClick={()=>setShowSettings(s=>!s)} style={{background:'none',border:'none',color:showSettings?accent:'#444',cursor:'pointer',fontSize:15,padding:'4px 8px',WebkitAppRegion:'no-drag',flexShrink:0}}>⚙</button>
      </div>

      {/* ── BODY ── */}
      <div style={{flex:1,display:'flex',overflow:'hidden'}}>

        {/* ── CHAT ── */}
        <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
          {/* Active agent banner */}
          {activeAg&&!activeAg.isPrimary&&(
            <div style={{padding:'5px 18px',background:`${activeAg.color||accent}11`,borderBottom:`1px solid ${activeAg.color||accent}22`,display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
              <span style={{fontSize:13}}>{activeAg.emoji}</span>
              <span style={{fontFamily:'sans-serif',fontSize:12,color:activeAg.color||accent,fontWeight:600}}>Talking directly to {activeAg.name}</span>
              {activeAg.backend&&activeAg.backend!=='claude_api'&&<span style={{fontFamily:'sans-serif',fontSize:10,color:'#444',padding:'1px 6px',background:'#0a0a18',borderRadius:3,border:'1px solid #ffffff08'}}>{BACKENDS[activeAg.backend]?.label}</span>}
              {runningIds.has(activeAg.id)&&terminals.includes(activeAg.id)&&<span style={{fontFamily:'sans-serif',fontSize:10,color:'#22C55E'}}>● live terminal — input goes directly to agent</span>}
              <button onClick={()=>setActiveAgentId(null)} style={{marginLeft:'auto',background:'none',border:'none',color:'#444',cursor:'pointer',fontSize:11}}>× back to DEF</button>
            </div>
          )}

          {/* Messages */}
          <div style={{flex:1,overflowY:'auto',padding:'16px 20px',display:'flex',flexDirection:'column',gap:12}}>
            {msgs.map(m=><Bubble key={m.id} msg={m} agents={agents} accent={accent}/>)}
            {isLoading&&(
              <div style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0'}}>
                <div style={{width:6,height:6,borderRadius:'50%',background:accent,animation:'pulse 1s infinite'}}/>
                <span style={{fontFamily:'sans-serif',fontSize:11,color:'#444'}}>{status||'Working…'}</span>
              </div>
            )}
            <div ref={endRef}/>
          </div>

          {/* Input */}
          <div style={{flexShrink:0,padding:'10px 16px',borderTop:'1px solid #ffffff08',background:`${bg}ee`,paddingBottom:termHeight>0?`${termHeight+16}px`:'10px',transition:'padding .3s'}}>
            <div style={{display:'flex',gap:8,alignItems:'flex-end'}}>
              <textarea value={input} onChange={e=>setInput(e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}}
                placeholder={activeAg&&!activeAg.isPrimary
                  ? (activeAg.backend==='local_cli'&&terminals.includes(activeAg.id)
                    ? `Type to ${activeAg.name} terminal (Enter sends directly)…`
                    : `Message ${activeAg.name} directly…`)
                  : `Message DEF… or @AgentName to address directly`}
                rows={1}
                style={{flex:1,background:'#0e0e1c',border:`1px solid #ffffff18`,color:'#e0e0f0',padding:'10px 14px',borderRadius:10,fontFamily:'sans-serif',fontSize:14,resize:'none',outline:'none',lineHeight:1.5,maxHeight:120,overflow:'auto'}}
                onFocus={e=>e.target.style.borderColor=accent} onBlur={e=>e.target.style.borderColor='#ffffff18'}/>
              <button onClick={send} disabled={isLoading||!input.trim()}
                style={{padding:'10px 18px',background:isLoading||!input.trim()?'#1a1a2e':`linear-gradient(135deg,${accent},${accent}88)`,border:'none',color:isLoading||!input.trim()?'#333':'#07070f',borderRadius:10,cursor:isLoading||!input.trim()?'default':'pointer',fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:700,letterSpacing:'0.1em',flexShrink:0}}>
                SEND
              </button>
            </div>
          </div>
        </div>

        {/* ── SETTINGS PANEL ── */}
        {showSettings&&(
          <div style={{width:300,background:'#060614',borderLeft:'1px solid #ffffff12',display:'flex',flexDirection:'column',overflow:'hidden',flexShrink:0}}>
            <div style={{padding:'14px 16px 10px',borderBottom:'1px solid #ffffff12',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
              <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:14,fontWeight:700,letterSpacing:'0.2em',color:accent}}>SETTINGS</span>
              <button onClick={()=>setShowSettings(false)} style={{background:'none',border:'none',color:'#555',cursor:'pointer',fontSize:15}}>✕</button>
            </div>
            <div style={{display:'flex',borderBottom:'1px solid #ffffff12',flexShrink:0}}>
              {[['keys','🔑 Keys'],['theme','🎨 Theme'],['danger','⚠️']].map(([id,l])=>(
                <button key={id} onClick={()=>setSettingsTab(id)}
                  style={{flex:1,padding:'9px 4px',border:'none',borderBottom:`2px solid ${settingsTab===id?accent:'transparent'}`,background:'transparent',color:settingsTab===id?accent:'#444',cursor:'pointer',fontFamily:"'Barlow Condensed',sans-serif",fontSize:10,fontWeight:700,letterSpacing:'0.12em'}}>{l}</button>
              ))}
            </div>
            <div style={{flex:1,overflowY:'auto',padding:'14px'}}>
              {settingsTab==='keys'&&(
                <div style={{display:'flex',flexDirection:'column',gap:12}}>
                  {[
                    {l:'Anthropic',v:anthropicKey,s:setAnthropicKey,p:'sk-ant-api03-…',b:'REQUIRED',bc:'#D4A853'},
                    {l:'OpenAI / Whisper',v:whisperKey,s:setWhisperKey,p:'sk-proj-…',b:'OPTIONAL',bc:'#22C55E'},
                    {l:'OpenRouter',v:openRouterKey,s:setOrKey,p:'sk-or-v1-…',b:'200+ models',bc:'#4A9EE8'},
                    {l:'Groq',v:groqKey,s:setGroqKey,p:'gsk_…',b:'FREE FAST',bc:'#A855F7'},
                  ].map(k=>(
                    <div key={k.l} style={{background:'#0a0a18',borderRadius:8,padding:'10px 12px',border:`1px solid ${k.v?k.bc+'33':'#ffffff08'}`}}>
                      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
                        <span style={{fontFamily:'sans-serif',fontSize:12,fontWeight:700,color:k.v?'#fff':'#777',flex:1}}>{k.l}</span>
                        <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:9,color:k.bc,padding:'1px 5px',background:`${k.bc}18`,borderRadius:3}}>{k.b}</span>
                        {k.v&&<div style={{width:5,height:5,borderRadius:'50%',background:'#22C55E'}}/>}
                      </div>
                      <input type="password" value={k.v} onChange={e=>k.s(e.target.value)} placeholder={k.p}
                        style={{width:'100%',background:'#060612',border:'1px solid #ffffff12',color:'#ccc',padding:'7px 9px',borderRadius:6,fontFamily:"'JetBrains Mono',monospace",fontSize:10,outline:'none'}}/>
                    </div>
                  ))}
                </div>
              )}
              {settingsTab==='theme'&&(
                <div style={{display:'flex',flexDirection:'column',gap:10}}>
                  <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                    {THEMES.map(t=><button key={t.id} onClick={()=>{setAccent(t.c1);setBg(t.bg)}} style={{padding:'5px 10px',background:`${t.c1}18`,color:t.c1,border:`1px solid ${t.c1}44`,borderRadius:6,cursor:'pointer',fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,fontWeight:700}}>{t.id.toUpperCase()}</button>)}
                  </div>
                  <div><div style={{fontFamily:'sans-serif',fontSize:11,color:'#777',marginBottom:5}}>Accent</div><input type="color" value={accent} onChange={e=>setAccent(e.target.value)} style={{width:'100%',height:32,border:'none',background:'none',cursor:'pointer',padding:0,borderRadius:6}}/></div>
                  <div><div style={{fontFamily:'sans-serif',fontSize:11,color:'#777',marginBottom:5}}>Background</div><input type="color" value={bg} onChange={e=>setBg(e.target.value)} style={{width:'100%',height:32,border:'none',background:'none',cursor:'pointer',padding:0,borderRadius:6}}/></div>
                </div>
              )}
              {settingsTab==='danger'&&(
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  <button onClick={()=>{if(confirm('Clear all agents and start over?')){setAgents([]);setOnboarded(false);setMsgs([]);setRunning(new Set());setTerminals([]);DE.saveSettings({onboarded:false,agents:[]})}}}
                    style={{padding:'10px',background:'#1a0808',border:'1px solid #EF444433',color:'#EF444488',borderRadius:8,cursor:'pointer',fontFamily:'sans-serif',fontSize:12}}>Reset everything</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── TERMINAL PANELS ── */}
      {terminals.length>0&&(
        <div style={{position:'fixed',bottom:0,left:0,right:0,height:termHeight,background:'#010108',borderTop:`2px solid ${accent}33`,display:'flex',zIndex:80}}>
          {terminals.map(agId=>{
            const ag=agents.find(a=>a.id===agId)
            if(!ag) return null
            return (
              <div key={agId} style={{flex:1,minWidth:260,borderRight:'1px solid #1a1a2e'}}>
                <Terminal agent={ag}
                  onClose={()=>{setTerminals(p=>p.filter(id=>id!==agId));setRunning(p=>{const n=new Set(p);n.delete(agId);return n})}}
                  onReady={()=>setRunning(p=>new Set([...p,agId]))}/>
              </div>
            )
          })}
        </div>
      )}

      {/* ── ADD AGENT WIZARD ── */}
      {showAdd&&(
        <AddAgentWizard accent={accent}
          onAdd={ag=>{
            setAgents(p=>[...p,ag])
            setShowAdd(false)
            addMsg({role:'system-info',content:`${ag.emoji} ${ag.name} added [${BACKENDS[ag.backend]?.label}]`})
            // Auto-open terminal for local CLI agents
            if(ag.backend==='local_cli'){
              setTerminals(p=>p.includes(ag.id)?p:[...p,ag.id])
            }
          }}
          onCancel={()=>setShowAdd(false)}/>
      )}
    </div>
  )
}
