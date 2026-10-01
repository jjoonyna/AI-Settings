vim.opt.swapfile = false
vim.opt.shadafile = 'NONE'
local child = { vim.fn.exepath('node'), '-e', 'let n=0;setInterval(()=>console.log("tick "+(++n)),100)' }
vim.g.probe_chan = vim.fn.jobstart(child, { term = true })
assert(vim.g.probe_chan > 0)
vim.g.probe_pid = vim.fn.jobpid(vim.g.probe_chan)
vim.g.probe_buf = vim.api.nvim_get_current_buf()
