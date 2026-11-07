"""Real Neovim embed UI regression. Run with the installed tool Python (pip + msgpack vendor).
No model, account, Windows Terminal window, or global installation is used.
"""
import os
from pathlib import Path
import queue
import shutil
import subprocess
import tempfile
import threading
import time
from pip._vendor import msgpack

repo = Path(__file__).resolve().parents[3]
with tempfile.TemporaryDirectory(prefix='ai-workspace-ui-') as folder:
    env = dict(os.environ, XDG_CONFIG_HOME=str(repo), AGENT_HUB_HOME=folder)
    for name in ['NVIM', 'AGENT_HUB_INSTANCE', 'AGENT_HUB_REQUEST', 'AGENT_HUB_MANAGED']:
        env.pop(name, None)
    process = subprocess.Popen([shutil.which('nvim'), '--embed', '-u', 'NONE', '-i', 'NONE'],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    replies = queue.Queue()
    serial = 0

    def receive():
        unpacker = msgpack.Unpacker(raw=False, strict_map_key=False)
        while chunk := process.stdout.read1(65536):
            unpacker.feed(chunk)
            for value in unpacker:
                if value[0] == 1:
                    replies.put(value)

    threading.Thread(target=receive, daemon=True).start()

    def rpc(method, args):
        global serial
        serial += 1
        process.stdin.write(msgpack.packb([0, serial, method, args], use_bin_type=True))
        process.stdin.flush()
        result = replies.get(timeout=15)
        assert result[1] == serial, result
        if result[2] is not None:
            raise RuntimeError(result[2])
        return result[3]

    def lua(code):
        return rpc('nvim_exec_lua', [code, []])

    def wait(code):
        until = time.monotonic() + 5
        while time.monotonic() < until:
            if lua(code):
                return
            time.sleep(.03)
        raise AssertionError((code, lua("return {mouse=vim.fn.getmousepos(), mode=vim.api.nvim_get_mode().mode, error=vim.v.errmsg, selected=W.state.selected}")))

    def click(kind, line, col=2):
        position = lua(f"return vim.api.nvim_win_get_position(W.state.{kind})")
        # The workspace winbar occupies the first screen row of each pane.
        rpc('nvim_input_mouse', ['left', 'press', '', 0, position[0] + line, position[1] + col])
        rpc('nvim_input_mouse', ['left', 'release', '', 0, position[0] + line, position[1] + col])

    try:
        rpc('nvim_ui_attach', [190, 45, {'rgb': True, 'ext_linegrid': True}])
        lua("""
vim.opt.rtp:prepend(vim.fn.stdpath('config'))
vim.o.mouse = 'a'
dofile(vim.fn.stdpath('config') .. '/lua/config/keymaps.lua')
W, T, R = require('config.agent.workspace'), require('config.agent.terminal'), require('config.agent.reviews')
W.open(false)
local cmd = {vim.fn.exepath('node'), '-e', 'setInterval(()=>{},1000)'}
a = assert(T.spawn({cmd=cmd, agent='Codex', role='plan', model='gpt-6.1-sol', name='계획 | A', cwd=vim.fn.getcwd()}))
b = assert(T.spawn({cmd=cmd, agent='Codex', role='work', model='gpt-6.1-terra', name='작업 | B', cwd=vim.fn.getcwd(), env={AGENT_PARENT_ID=tostring(a)}}))
local root = vim.env.AGENT_HUB_HOME .. '/docs/user-review'
vim.fn.mkdir(root, 'p')
p, q = root .. '/first.md', root .. '/긴한글제목 English document title for resize testing.md'
vim.fn.writefile({'# First'},p); vim.fn.writefile({'# Second'},q)
W.select(a,true)
""")
        rpc('nvim_input', ['<C-w>'])
        wait("return vim.api.nvim_get_mode().mode == 't'")
        assert lua("return require('config.agent.plan_preview').show({path=p,owner=b}):match('^OK') ~= nil")
        assert lua("return vim.api.nvim_get_current_win() == W.state.chat and vim.api.nvim_get_mode().mode == 't'")
        rpc('nvim_input', ['<C-q>'])
        wait("return vim.api.nvim_get_mode().mode:sub(1,1) == 'n'")
        rpc('nvim_input', ['<A-h>'])
        wait("return vim.api.nvim_get_current_win() == W.state.ai")
        rpc('nvim_input', ['<A-l>'])
        wait("return vim.api.nvim_get_current_win() == W.state.chat")
        rpc('nvim_input', ['<C-w>'])
        wait("return vim.api.nvim_get_mode().mode == 't'")
        # Native mouse coordinates: arrow only folds, title and model select.
        # Compare rendered grid attributes for both selected text rows against an unselected row.
        def selected_grid():
            return lua("""local w=W.state.ai; local p=vim.api.nvim_win_get_position(w); local r=W.state.rows
          local title=vim.fn.screenattr(p[1]+r[1].first+1,p[2]+8)
          local model=vim.fn.screenattr(p[1]+r[1].last+1,p[2]+5)
          local other=vim.fn.screenattr(p[1]+r[2].last+1,p[2]+5)
          local tail1=vim.fn.screenattr(p[1]+r[1].first+1,p[2]+25)
          local tail2=vim.fn.screenattr(p[1]+r[1].last+1,p[2]+25)
          local other_tail=vim.fn.screenattr(p[1]+r[2].last+1,p[2]+25)
          return title ~= other and model ~= other and tail1 ~= other_tail and tail2 ~= other_tail
        """)
        assert selected_grid()
        for theme in ('light', 'dark'):
            lua(f"vim.o.background='{theme}'; vim.api.nvim_exec_autocmds('ColorScheme', {{}}); W.refresh(); vim.cmd('redraw')")
            assert selected_grid(), theme
        click('ai', 1, 0)
        wait("return #W.state.rows == 1")
        assert lua("return W.state.selected == a and vim.api.nvim_get_current_win() == W.state.chat")
        lua("W.refresh()")
        assert lua("return #W.state.rows == 1")
        time.sleep(.6)
        click('ai', 1, 0)
        wait("return #W.state.rows == 2")
        click('ai', 4, 8)
        wait("return vim.api.nvim_win_get_buf(W.state.chat) == T.registry[b].buf")
        click('ai', 1, 6)
        wait("return vim.api.nvim_win_get_buf(W.state.chat) == T.registry[a].buf")
        assert lua("return require('config.agent.plan_preview').show({path=q,owner=a}):match('^OK') ~= nil")
        click('docs', 3)
        time.sleep(.1)
        assert lua("return vim.api.nvim_buf_get_lines(W.state.body_buf,0,1,false)[1] == '# First'")
        click('docs', 4)
        wait("return vim.api.nvim_buf_get_lines(W.state.body_buf,0,1,false)[1] == '# Second'")
        click('docs', 1)
        wait("return vim.api.nvim_buf_get_lines(W.state.body_buf,0,1,false)[1] == '# First'")
        click('docs', 5)
        wait("return vim.api.nvim_buf_get_lines(W.state.body_buf,0,1,false)[1] == '# Second'")
        click('docs', 2)
        wait("return vim.api.nvim_buf_get_lines(W.state.body_buf,0,1,false)[1] == '# First'")
        assert lua("return W.state.selected == a and vim.fn.jobwait({T.registry[b].chan},0)[1] == -1")
        rpc('nvim_ui_try_resize', [70, 30])
        time.sleep(.1)
        lua("W.refresh(); W.show('docs')")
        click('docs', 4)
        wait("return W.state.document == R.items()[2].id")
        rpc('nvim_ui_try_resize', [190, 45])
        wait("return #vim.api.nvim_tabpage_list_wins(W.state.tab) == 4")
        lua("""T.registry[a].name = '계획 | 긴한글제목 English plan title for resize testing'
W.refresh(); W.state.timer:stop()
resize_events = 0
vim.api.nvim_create_autocmd('WinResized', {callback=function() resize_events=resize_events+1 end})
""")
        def title_state():
            return lua("""local s=W.state
local info=vim.fn.getwininfo(s.docs)[1]
return {width=info.width-info.textoff, aiwidth=vim.fn.getwininfo(s.ai)[1].width-vim.fn.getwininfo(s.ai)[1].textoff,
  doc=vim.api.nvim_buf_get_lines(s.docs_buf,3,4,false)[1], owner=vim.api.nvim_buf_get_lines(s.docs_buf,4,5,false)[1],
  ai=vim.api.nvim_buf_get_lines(s.ai_buf,0,1,false)[1], name=T.registry[a].name, path=R.items()[2].path,
  height=vim.api.nvim_win_text_height(s.docs,{start_row=3,end_row=3}).all, events=resize_events}
""")
        def separators_fit():
            return lua("""local s=W.state; local ns=vim.api.nvim_get_namespaces().agent_workspace_separator
for _, kind in ipairs({'ai','docs'}) do
  local w,b=s[kind],s[kind..'_buf']; local info=vim.fn.getwininfo(w)[1]
  local line=vim.api.nvim_buf_get_lines(b,2,3,false)[1]
  local marks=vim.api.nvim_buf_get_extmarks(b,ns,{2,0},{2,-1},{details=true})
  if vim.fn.strdisplaywidth(line) ~= info.width-info.textoff or #marks ~= 1 or marks[1][4].hl_group ~= 'WinSeparator' then return false end
end
return true""")
        lua("vim.api.nvim_win_set_width(W.state.docs, 18); vim.api.nvim_win_set_width(W.state.ai, 18)")
        wait("return resize_events > 0 and vim.api.nvim_win_get_width(W.state.docs) == 18 and vim.api.nvim_win_get_width(W.state.ai) == 18 and vim.api.nvim_buf_get_lines(W.state.docs_buf,3,4,false)[1]:match('%.%.%.$') ~= nil")
        narrow = title_state()
        assert separators_fit()
        assert narrow['doc'].startswith('> 긴한글') and narrow['doc'].endswith('...') and narrow['height'] == 1, narrow
        assert lua("local s=W.state; local x=vim.api.nvim_buf_get_lines(s.docs_buf,3,4,false)[1]; return vim.fn.strdisplaywidth(x)") <= narrow['width']
        assert lua("local s=W.state; return vim.fn.strdisplaywidth(vim.api.nvim_buf_get_lines(s.ai_buf,0,1,false)[1])") <= narrow['aiwidth']
        assert narrow['owner'].endswith('...') and narrow['ai'].endswith('...'), narrow
        lua("resize_events=0; vim.api.nvim_win_set_width(W.state.docs, 40); vim.api.nvim_win_set_width(W.state.ai, 40)")
        wait("return resize_events > 0 and vim.api.nvim_win_get_width(W.state.docs) == 40 and vim.api.nvim_win_get_width(W.state.ai) == 40 and vim.fn.strdisplaywidth(vim.api.nvim_buf_get_lines(W.state.docs_buf,3,4,false)[1]) > 18")
        wide = title_state()
        assert separators_fit()
        assert len(wide['doc']) > len(narrow['doc']) and len(wide['ai']) > len(narrow['ai']), (narrow, wide)
        assert wide['name'] == narrow['name'] and wide['path'] == narrow['path'] and wide['path'].endswith('긴한글제목 English document title for resize testing.md'), wide
        assert lua("local s=W.state; return vim.fn.strdisplaywidth(vim.api.nvim_buf_get_lines(s.docs_buf,3,4,false)[1])") <= wide['width']
        assert lua("local s=W.state; return vim.fn.strdisplaywidth(vim.api.nvim_buf_get_lines(s.docs_buf,4,5,false)[1])") <= wide['width']
        lua("resize_events=0; vim.api.nvim_win_set_width(W.state.docs, 18); vim.api.nvim_win_set_width(W.state.ai, 18)")
        wait("return resize_events > 0 and vim.api.nvim_win_get_width(W.state.docs) == 18 and vim.api.nvim_win_get_width(W.state.ai) == 18 and vim.fn.strdisplaywidth(vim.api.nvim_buf_get_lines(W.state.docs_buf,3,4,false)[1]) <= 18")
        restored = title_state()
        assert all(restored[key] == narrow[key] for key in ('doc', 'owner', 'ai', 'name', 'path')), (narrow, restored)
        assert lua("return vim.fn.readfile(q)[1] == '# Second'")
        lua("W.state.timer:start(1000,1000,vim.schedule_wrap(W.refresh))")
        lua("""local cmd={vim.fn.exepath('node'),'-e','setInterval(()=>{},1000)'}
review=assert(T.spawn({cmd=cmd,role='review',name='Review',env={AGENT_PARENT_ID=tostring(a)}}))
c=assert(T.spawn({cmd=cmd,role='plan',name='C'}))
d=assert(T.spawn({cmd=cmd,role='work',name='D',env={AGENT_PARENT_ID=tostring(c)}}))
W.select(b,true); W.refresh()
""")
        def ai_line(session):
            return lua(f"for _,r in ipairs(W.state.rows) do if r.entry.id == {session} then return r.first end end")
        review_id, c_id, d_id = lua('return {review,c,d}')
        click('ai', ai_line(review_id), 8)
        wait('return W.state.selected == review and W.state.expanded == a')
        time.sleep(.6)
        click('ai', ai_line(c_id), 0)
        wait('return W.state.expanded == c and W.state.selected == review')
        time.sleep(.6)
        click('ai', ai_line(d_id), 8)
        wait('return W.state.selected == d and W.state.expanded == c')
        assert lua('return vim.fn.jobwait({T.registry[b].chan},0)[1] == -1')
        # Selecting a child from terminal input takes effect on the first click.
        lua('W.select(b,true)')
        rpc('nvim_input', ['<C-w>'])
        wait("return vim.api.nvim_get_mode().mode == 't'")
        time.sleep(.6)
        click('ai', ai_line(review_id), 8)
        wait('return W.state.selected == review and W.state.expanded == a')
        print('PASS embed UI: terminal input focus, AI/document mouse selection, independent selection, hidden live job, narrow/restore')
    finally:
        try:
            process.stdin.write(msgpack.packb([2, 'nvim_command', ['qa!']], use_bin_type=True))
            process.stdin.flush()
            process.wait(timeout=5)
        except (BrokenPipeError, subprocess.TimeoutExpired):
            process.kill()
