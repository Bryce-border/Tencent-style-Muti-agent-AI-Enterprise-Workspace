"""Real file lifecycle verification against Java, MinIO and Elasticsearch."""
import io
import json
import time
from pathlib import Path
import httpx

ROOT=Path(__file__).resolve().parent

def main():
    accounts=json.loads((ROOT.parent/'.tools/r2-demo-credentials.json').read_text(encoding='utf-8'))
    base='http://localhost:8080'
    with httpx.Client(base_url=base,timeout=45,headers={'X-Workspace-Request':'1','Origin':base}) as client:
        def call(method,path,**kwargs):
            response=client.request(method,path,**kwargs);response.raise_for_status();return response
        account=accounts[0]
        profile=call('POST','/auth/login',json={'username':account['username'],'password':account['password']}).json()
        space=next(s['id'] for s in profile['workspaces'] if s['name']==account['workspace_name'] and s['role']=='ADMIN')
        assert space!='default';call('POST','/auth/workspace',json={'workspace_id':space})
        def wait(id):
            for _ in range(70):
                value=call('GET',f'/v1/documents/{id}').json()
                if value['status'] not in ['PENDING','INDEXING']:return value
                time.sleep(2)
            raise AssertionError('index timeout')
        source='模拟业务制度：星云计划差旅报销。出差结束后30天内提交报销单和发票，上海住宿标准每晚600元。'
        raw=source.encode()
        doc=call('POST','/v1/documents',files={'file':('模拟差旅制度.txt',raw,'text/plain')}).json();id=doc['id']
        doc=wait(id);assert doc['status']=='READY',doc['versions'][0].get('error')
        assert source==doc['versions'][0]['extracted_text']
        result=call('GET',f'/v1/documents/{id}/versions/1/download');assert result.content==raw and 'filename' in result.headers['content-disposition']
        print('PASS upload, parsing, preview and original download',id,flush=True)
        hits=call('GET','/v1/knowledge/search',params={'q':'星云计划出差报销时限'}).json()
        assert any(h.get('metadata',{}).get('file_document_id')==id for h in hits)
        print('PASS uploaded document is searchable',flush=True)
        call('POST',f'/v1/documents/{id}/versions',files={'file':('模拟差旅制度.txt','模拟业务制度：星云计划差旅报销。出差结束后15天内提交报销单。'.encode(),'text/plain')})
        doc=wait(id);assert doc['status']=='READY' and doc['active_version']==2 and len(doc['versions'])==2
        hits=call('GET','/v1/knowledge/search',params={'q':'星云计划差旅报销'}).json()
        mine=[h for h in hits if h.get('metadata',{}).get('file_document_id')==id]
        assert mine and all('15天' in h['content'] and '30天' not in h['content'] for h in mine)
        assert call('GET',f'/v1/documents/{id}/versions/1/download').content==raw
        print('PASS version replacement, latest search and old original retained',flush=True)
        call('POST',f'/v1/documents/{id}/archive',json={'archived':True})
        hits=call('GET','/v1/knowledge/search',params={'q':'星云计划差旅报销'}).json()
        assert all(h.get('metadata',{}).get('file_document_id')!=id for h in hits)
        call('POST',f'/v1/documents/{id}/archive',json={'archived':False})
        assert not call('GET',f'/v1/documents/{id}').json()['archived']
        print('PASS archive removes retrieval and restore works',flush=True)
        bad=call('POST','/v1/documents',files={'file':('损坏文件.pdf',b'not a pdf','application/pdf')}).json()
        failed=wait(bad['id']);assert failed['status']=='FAILED' and failed['versions'][0]['error']
        call('POST',f"/v1/documents/{bad['id']}/retry");assert wait(bad['id'])['status']=='FAILED'
        print('PASS malformed file has visible failure and can retry',flush=True)
        for item in [id,bad['id']]:call('POST',f'/v1/documents/{item}/archive',json={'archived':True})
        other=accounts[1]
        other_profile=call('POST','/auth/login',json={'username':other['username'],'password':other['password']}).json()
        other_space=next(s['id'] for s in other_profile['workspaces'] if s['name']==other['workspace_name'] and s['role']=='ADMIN')
        call('POST','/auth/workspace',json={'workspace_id':other_space})
        for suffix in ['', '/versions/1/download']:
            assert client.get(f'/v1/documents/{id}{suffix}').status_code==404
        print('PASS cross-workspace preview/download blocked; fixtures archived',flush=True)

if __name__=='__main__':main()
