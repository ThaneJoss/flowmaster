"""Generate the standalone OpenAPI document shipped with FlowMaster."""
import json
from pathlib import Path

def string(**kwargs): return {'type':'string', **kwargs}
def obj(properties,required=()): return {'type':'object','properties':properties,'required':list(required)}
def ref(name): return {'$ref':f'#/components/schemas/{name}'}
def array(schema): return {'type':'array','items':schema}
def response(schema,description='成功'): return {'description':description,'content':{'application/json':{'schema':obj({'data':schema},['data'])}}}
def body(schema): return {'required':True,'content':{'application/json':{'schema':schema}}}
status=string(enum=['pending','running','verified','rejected'])
base={'id':string(maxLength=100),'updatedAt':string(format='date-time'),'revision':{'type':'integer','minimum':1,'description':'更新时必须携带最近读取到的版本号。'}}
node=obj({'id':string(),'title':string(maxLength=200),'type':string(enum=['baseline','observation','hypothesis','experiment','conclusion']),'status':status,'x':{'type':'number','minimum':0,'maximum':10000},'y':{'type':'number','minimum':0,'maximum':10000},**{k:string(default='') for k in ['inputs','output','summary','rationale','method','conclusion','nextAction','startedAt','duration']}},['id','title','type','status','x','y'])
schemas={
 'Node':node,
 'Project':obj({**base,'name':string(maxLength=200),'description':string(default='')},['name']),
 'Hypothesis':obj({**base,'projectId':string(),'title':string(maxLength=200),'description':string(default=''),'baseline':string(default=''),'status':status,'nodes':{'type':'array','items':ref('Node'),'maxItems':120},'edges':{'type':'array','items':obj({'source':string(),'target':string()},['source','target']),'maxItems':360}},['projectId','title','status','nodes','edges']),
 'Experiment':obj({**base,'hypothesisId':string(),'nodeId':string(),'title':string(maxLength=200),'status':status,'summary':string(),'source':string(enum=['manual','agent'],default='manual'),'duration':string(default=''),'logs':array(obj({'time':string(),'message':string()},['time','message']))},['hypothesisId','nodeId','title','status']),
 'Resource':obj({**base,'projectId':string(),'name':string(maxLength=200),'type':string(enum=['dataset','model','document','code']),'url':string(description='空字符串或 HTTP(S) URL'),'description':string(default='')},['projectId','name','type']),
 'ResultInput':obj({'nodeId':string(),'title':string(maxLength=200),'status':status,'summary':string(minLength=1,maxLength=16000),'duration':string(default='')},['nodeId','title','status','summary']),
 'TokenInput':obj({'name':string(maxLength=80),'scope':string(enum=['read','write','admin']),'expiresInDays':{'type':'integer','minimum':1,'maximum':365}},['name','scope','expiresInDays']),
 'AccessToken':obj({'id':string(),'name':string(),'prefix':string(),'scope':string(enum=['read','write','admin']),'createdAt':string(format='date-time'),'expiresAt':string(format='date-time',nullable=True),'lastUsedAt':string(format='date-time',nullable=True)}),
 'ModelInput':obj({'baseUrl':string(format='uri',description='公共 HTTPS 域名，禁止 IP 地址、查询参数、URL 凭据及重定向'),'model':string(maxLength=120),'apiKey':string(maxLength=4096,description='首次保存或切换域名时必填；留空保留现有 Key。')},['baseUrl','model']),
 'ModelSettings':obj({'baseUrl':string(),'model':string(),'hasKey':{'type':'boolean'}}),
 'Error':obj({'error':obj({'code':string(),'message':string()},['code','message'])},['error'])
}
schemas['Workspace']=obj({k:array(ref(v)) for k,v in [('projects','Project'),('hypotheses','Hypothesis'),('experiments','Experiment'),('resources','Resource')]})
errors={str(n):{'description':desc,'content':{'application/json':{'schema':ref('Error')}}} for n,desc in [(400,'请求 JSON 无效'),(401,'Token 无效、过期或已撤销'),(403,'权限或来源域名不允许'),(404,'记录或接口不存在'),(409,'版本冲突或状态冲突'),(413,'请求体/工作区超过大小上限'),(422,'字段校验失败'),(429,'调用频率超过限制'),(502,'模型服务异常'),(503,'数据库或服务端 Secret 未配置')]}
def operation(summary,tag,success_schema=None,code='200',input_schema=None,params=None):
 d={'summary':summary,'tags':[tag],'responses':{code:response(success_schema or obj({'deleted':{'type':'boolean'}})),**{k:v for k,v in errors.items() if k in ['401','403','404','409','422','429','503']}}}
 if input_schema:d['requestBody']=body(input_schema)
 if params:d['parameters']=params
 return d
id_param={'name':'id','in':'path','required':True,'schema':string()}
paths={
 '/health':{'get':{'summary':'服务存活检查','security':[],'tags':['System'],'responses':{'200':response(obj({'name':string(),'version':string()}))}}},
 '/workspace':{'get':operation('读取工作区快照（最多 5000 条记录 / 8 MB）','Workspace',ref('Workspace'))},
 '/seed':{'post':operation('向空工作区导入示例（管理员）','Workspace',obj({'imported':{'type':'integer'}}),'201')},
}
for collection,name in [('projects','Project'),('hypotheses','Hypothesis'),('experiments','Experiment'),('resources','Resource')]:
 query=[{'name':n,'in':'query','schema':s} for n,s in [('limit',{'type':'integer','minimum':1,'maximum':200,'default':50}),('offset',{'type':'integer','minimum':0,'default':0}),('q',string()),('projectId',string(description='项目筛选，适用于假设和资源'))]]
 paths[f'/{collection}']={'get':operation(f'分页查询 {name}',name,array(ref(name)),params=query),'post':operation(f'创建 {name}',name,ref(name),'201',ref(name))}
 paths[f'/{collection}']['get']['responses']['200']['headers']={'X-Total-Count':{'description':'匹配记录总数','schema':{'type':'integer'}}}
 paths[f'/{collection}/{{id}}']={'get':operation(f'读取 {name}',name,ref(name),params=[id_param]),'put':operation(f'替换 {name}（必须携带 revision）',name,ref(name),input_schema={'allOf':[ref(name),{'type':'object','required':['revision']}]},params=[id_param]),'delete':operation(f'删除 {name}',name,params=[id_param])}
paths['/hypotheses/{id}/results']={'post':operation('原子写入实验结果并更新节点状态','Hypothesis',ref('Experiment'),'201',ref('ResultInput'),[id_param])}
paths['/hypotheses/{id}/run']={'post':operation('调用模型分析指定节点；分析结果不会自动视为验证通过','Hypothesis',ref('Experiment'),'201',obj({'nodeId':string()},['nodeId']),[id_param])}
paths['/tokens']={'get':operation('查询 Token 元数据（管理员）','Tokens',array(ref('AccessToken'))),'post':operation('创建 Token（管理员）；完整 token 只返回一次','Tokens',{'allOf':[ref('AccessToken'),obj({'token':string()})]},'201',ref('TokenInput'))}
paths['/tokens/{id}']={'delete':operation('立即撤销 Token（管理员）','Tokens',params=[id_param])}
paths['/settings/model']={'get':operation('读取脱敏的模型设置（管理员）','Settings',ref('ModelSettings')),'put':operation('保存模型接口及加密 Key（管理员）','Settings',ref('ModelSettings'),input_schema=ref('ModelInput'))}
paths['/settings/model/test']={'post':operation('对已保存的接口发出一次小型测试请求（管理员，可能计费）','Settings',obj({'message':string()}))}
for p in ['/hypotheses/{id}/run','/settings/model/test']:paths[p]['post']['responses']['502']=errors['502']
spec={'openapi':'3.0.3','info':{'title':'FlowMaster API','version':'1.0.0','description':'单一共享研究工作区的 REST API。前端和外部调用共享 D1 数据。写操作需要 write 或 admin；管理设置需要 admin。'},'servers':[{'url':'/api/v1'}],'security':[{'BearerAuth':[]}],'paths':paths,'components':{'securitySchemes':{'BearerAuth':{'type':'http','scheme':'bearer','description':'ADMIN_TOKEN 或系统设置中签发的 fm_ Token'}},'schemas':schemas}}
Path('public/openapi.json').write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')
print(f'Generated OpenAPI: {len(paths)} paths')
