-- bootstrap lazy.nvim, LazyVim and your plugins
require("config.lazy")

-- 화면 연결 전에도 작업 등록과 원격 요청을 처리한다.
require('config.agent.hub').setup()

