import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from urllib.error import URLError
import zipfile

PROJECT = Path(__file__).resolve().parents[1]
NAME = 'apes_release_runtime_tests'
spec = importlib.util.spec_from_file_location(NAME, PROJECT/'__init__.py', submodule_search_locations=[str(PROJECT)])
package = importlib.util.module_from_spec(spec)
sys.modules[NAME] = package
with patch.dict(sys.modules, {'server': SimpleNamespace(PromptServer=SimpleNamespace())}):
    spec.loader.exec_module(package)
runtime = sys.modules[NAME+'.nodes.apes_prompter11.runtime_installer'] if NAME+'.nodes.apes_prompter11.runtime_installer' in sys.modules else None
import importlib
runtime = importlib.import_module(NAME+'.nodes.apes_prompter11.runtime_installer')
discovery = importlib.import_module(NAME+'.nodes.apes_prompter11.managed_runtime')
processes = importlib.import_module(NAME+'.nodes.apes_prompter11.backends.llama_cpp_process')
providers = importlib.import_module(NAME+'.nodes.apes_prompter11.providers.registry')
BackendConfigurationError = runtime.BackendConfigurationError


def zip_bytes(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        for name, value in files.items():
            archive.writestr(name, value)
    return output.getvalue()


class Response(io.BytesIO):
    def geturl(self):
        return 'https://release-assets.githubusercontent.com/verified-test'


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.patch = patch.dict(sys.modules, {'folder_paths': SimpleNamespace(base_path=str(self.root),
            get_user_directory=lambda:str(self.root/'user'))})
        self.patch.start(); self.addCleanup(self.patch.stop)
        runtime._progress(phase='idle', message='', downloaded=0,total=0)
        processes.get_process_manager().cleanup_all()

    def entry(self, files=None):
        payload = zip_bytes(files or {'llama-server.exe':b'fake binary, never execute','ggml.dll':b'dll'})
        artifact = {'filename':'llama-btest-bin-win-cpu-x64.zip',
            'url':'https://github.com/ggml-org/llama.cpp/releases/download/btest/llama-btest-bin-win-cpu-x64.zip',
            'sha256':hashlib.sha256(payload).hexdigest(),'size':len(payload),'archive':'zip'}
        entry = {'id':'windows-x64-cpu','version':'btest','os':'windows','architecture':'x86_64',
            'display_name':'Test CPU','backend':'cpu','executable':'llama-server.exe','artifacts':[artifact]}
        return entry, payload

    def install(self, entry, payload, repair=False):
        with patch.object(runtime,'load_manifest',return_value={'schema_version':1,'runtimes':[entry]}), \
             patch.object(runtime,'_fetch',side_effect=lambda url:Response(payload)), \
             patch.object(runtime.platform,'system',return_value='Windows'), \
             patch.object(runtime.platform,'machine',return_value='AMD64'), \
             patch('subprocess.run',side_effect=AssertionError('Installer must not execute binaries')), \
             patch('subprocess.Popen',side_effect=AssertionError('Installer must not execute binaries')):
            return runtime.install_runtime(entry['id'], repair)

    def test_bundled_manifest_is_pinned_and_all_hashes_required(self):
        manifest = runtime.load_manifest()
        self.assertEqual(len(manifest['runtimes']),3)
        cuda = next(e for e in manifest['runtimes'] if e['backend']=='cuda')
        self.assertEqual(len(cuda['artifacts']),2)
        for entry in manifest['runtimes']:
            self.assertEqual(entry['version'],'b10516')
            for artifact in entry['artifacts']:
                self.assertEqual(len(artifact['sha256']),64)
                self.assertNotIn('latest',artifact['url'])

    def test_invalid_manifest_hash_rejected(self):
        entry,_=self.entry(); entry['artifacts'][0]['sha256']=''
        file=self.root/'manifest.json'; file.write_text(json.dumps({'schema_version':1,'runtimes':[entry]}))
        with patch.object(runtime,'MANIFEST_PATH',file), self.assertRaises(BackendConfigurationError):
            runtime.load_manifest()

    def test_install_verifies_and_never_executes(self):
        entry,payload=self.entry()
        result=self.install(entry,payload)
        self.assertTrue(result['available']); self.assertEqual(result['source'],'Managed')
        self.assertEqual(runtime.installation_status()['phase'],'complete')
        self.assertTrue(Path(result['path']).is_relative_to(self.root/'user'))
        self.assertFalse(list(runtime.managed_directory().glob('.apes-install-*')))

    def test_invalid_sha256_rejected_before_extraction_and_cleaned(self):
        entry,payload=self.entry(); entry['artifacts'][0]['sha256']='0'*64
        with self.assertRaises(BackendConfigurationError), patch.object(runtime,'extract_safe') as extract:
            self.install(entry,payload)
        extract.assert_not_called()
        self.assertFalse(runtime._target(entry).exists())
        self.assertFalse(list(runtime.managed_directory().glob('.apes-install-*')))

    def test_incomplete_download_rejected(self):
        entry,payload=self.entry()
        with self.assertRaises(BackendConfigurationError): self.install(entry,payload[:-4])
        self.assertFalse(list(runtime.managed_directory().glob('.apes-install-*')))

    def test_interrupt_cleanup(self):
        entry,payload=self.entry()
        class Interrupted(Response):
            def read(self,n=-1): raise OSError('connection interrupted')
        with patch.object(runtime,'load_manifest',return_value={'runtimes':[entry]}), \
             patch.object(runtime,'_fetch',return_value=Interrupted(payload)), \
             patch.object(runtime.platform,'system',return_value='Windows'), \
             patch.object(runtime.platform,'machine',return_value='AMD64'), self.assertRaises(BackendConfigurationError):
            runtime.install_runtime(entry['id'])
        self.assertFalse(list(runtime.managed_directory().glob('.apes-install-*')))

    def test_http_redirect_rejected(self):
        entry,payload=self.entry()
        response=Response(payload); response.geturl=lambda:'http://github.com/untrusted'
        with patch.object(runtime,'_fetch',return_value=response), self.assertRaises(BackendConfigurationError):
            runtime.download_artifact(entry['artifacts'][0],self.root/'archive')

    def test_redirect_is_rejected_before_following_it(self):
        from urllib.request import Request
        request=Request('https://github.com/ggml-org/llama.cpp/releases/download/btest/runtime.zip')
        for url in ['http://github.com/unsafe','https://foreign.invalid/runtime.zip']:
            with self.subTest(url=url), self.assertRaises(BackendConfigurationError):
                runtime.OfficialReleaseRedirect().redirect_request(request,None,302,'redirect',{},url)

    def test_zip_unsafe_names_rejected(self):
        for name in ['../escape','/absolute','..\\escape','C:/escape','folder/file:ads','NUL.txt','trailing.','//server/share']:
            with self.subTest(name=name):
                archive=self.root/'unsafe.zip'; archive.write_bytes(zip_bytes({name:b'x'}))
                with self.assertRaises(BackendConfigurationError): runtime.extract_safe(archive,self.root/'stage')
        self.assertFalse((self.root/'escape').exists())

    def test_zip_symlink_rejected(self):
        archive=self.root/'symlink.zip'
        with zipfile.ZipFile(archive,'w') as output:
            member=zipfile.ZipInfo('link'); member.external_attr=(0o120777<<16); output.writestr(member,'../escape')
        with self.assertRaises(BackendConfigurationError): runtime.extract_safe(archive,self.root/'stage')

    def test_zip_case_collision_rejected(self):
        archive=self.root/'duplicate.zip'; archive.write_bytes(zip_bytes({'DLL.dll':b'a','dll.dll':b'b'}))
        with self.assertRaises(BackendConfigurationError): runtime.extract_safe(archive,self.root/'stage')

    def test_tar_links_and_traversal_rejected(self):
        for name,kind in [('link',tarfile.SYMTYPE),('../escape',tarfile.REGTYPE)]:
            archive=self.root/'unsafe.tar'
            with tarfile.open(archive,'w') as output:
                member=tarfile.TarInfo(name); member.type=kind; member.linkname='../escape'; output.addfile(member)
            with self.assertRaises(BackendConfigurationError): runtime.extract_safe(archive,self.root/'stage','tar')

    def test_duplicate_install_and_remove_rejected(self):
        runtime._LOCK.acquire()
        try:
            with self.assertRaises(BackendConfigurationError): runtime.install_runtime()
            with self.assertRaises(BackendConfigurationError): runtime.remove_runtime()
        finally: runtime._LOCK.release()

    def test_auto_requires_explicit_hardware_choice(self):
        with self.assertRaises(BackendConfigurationError): runtime.install_runtime('auto')

    def test_failed_repair_keeps_existing_runtime(self):
        entry,payload=self.entry(); result=self.install(entry,payload)
        before=Path(result['path']).read_bytes(); entry['artifacts'][0]['sha256']='0'*64
        with self.assertRaises(BackendConfigurationError): self.install(entry,payload,repair=True)
        self.assertEqual(Path(result['path']).read_bytes(),before)

    def test_companion_archive_is_verified_and_both_are_required(self):
        entry,payload=self.entry()
        companion=zip_bytes({'cublas.dll':b'companion'})
        artifact={**entry['artifacts'][0], 'filename':'cudart-test.zip',
            'url':'https://github.com/ggml-org/llama.cpp/releases/download/btest/cudart-test.zip',
            'sha256':hashlib.sha256(companion).hexdigest(),'size':len(companion)}
        entry['artifacts'].append(artifact)
        with patch.object(runtime,'load_manifest',return_value={'runtimes':[entry]}), \
             patch.object(runtime,'_fetch',side_effect=[Response(payload),Response(companion)]), \
             patch.object(runtime.platform,'system',return_value='Windows'), patch.object(runtime.platform,'machine',return_value='AMD64'):
            runtime.install_runtime(entry['id'])
        self.assertEqual((runtime._target(entry)/'cublas.dll').read_bytes(),b'companion')
        artifact['sha256']='0'*64
        with patch.object(runtime,'load_manifest',return_value={'runtimes':[entry]}), \
             patch.object(runtime,'_fetch',side_effect=[Response(payload),Response(companion)]), \
             patch.object(runtime.platform,'system',return_value='Windows'), patch.object(runtime.platform,'machine',return_value='AMD64'), self.assertRaises(BackendConfigurationError):
            runtime.install_runtime(entry['id'],True)
        self.assertTrue((runtime._target(entry)/'llama-server.exe').is_file())

    def test_commit_failure_rolls_back_existing_runtime(self):
        entry,payload=self.entry(); result=self.install(entry,payload)
        before=Path(result['path']).read_bytes()
        with patch.object(runtime,'_write_active',side_effect=OSError('atomic write failed')), self.assertRaises(BackendConfigurationError):
            self.install(entry,payload,True)
        self.assertEqual(Path(result['path']).read_bytes(),before)

    def test_remove_rejects_active_inference(self):
        entry,payload=self.entry(); result=self.install(entry,payload)
        manager=processes.get_process_manager(); process=Mock(); process.poll.return_value=None
        manager._owned=SimpleNamespace(config=SimpleNamespace(executable=Path(result['path'])),process=process,references=1)
        try:
            with patch.object(runtime,'load_manifest',return_value={'runtimes':[entry]}), self.assertRaises(BackendConfigurationError):
                runtime.remove_runtime(entry['id'])
            self.assertTrue(Path(result['path']).exists()); process.terminate.assert_not_called()
        finally:
            manager._owned=None

    def test_repair_and_remove_do_not_touch_external_or_legacy(self):
        entry,payload=self.entry(); result=self.install(entry,payload)
        external=self.root/'external/llama-server.exe'; external.parent.mkdir(); external.write_bytes(b'external')
        legacy=self.root/'tools/ApesPrompter/llama.cpp/llama-server.exe'; legacy.parent.mkdir(parents=True); legacy.write_bytes(b'legacy')
        self.install(entry,payload,repair=True)
        with patch.object(runtime,'load_manifest',return_value={'runtimes':[entry]}): runtime.remove_runtime(entry['id'])
        self.assertFalse(Path(result['path']).exists())
        self.assertEqual(external.read_bytes(),b'external'); self.assertEqual(legacy.read_bytes(),b'legacy')

    def test_unmarked_folder_not_modified(self):
        entry,payload=self.entry(); target=runtime._target(entry); target.mkdir(parents=True); (target/'user.txt').write_text('keep')
        with self.assertRaises(BackendConfigurationError): self.install(entry,payload,repair=True)
        self.assertEqual((target/'user.txt').read_text(),'keep')

    def test_unsupported_platform_has_no_download(self):
        with patch.object(runtime.platform,'system',return_value='Linux'), patch.object(runtime,'_fetch') as fetch, self.assertRaises(BackendConfigurationError):
            runtime.install_runtime()
        fetch.assert_not_called()

    def test_discovery_priority_and_manual_override(self):
        entry,payload=self.entry(); result=self.install(entry,payload)
        legacy=self.root/'tools/ApesPrompter/llama.cpp/llama-server.exe'; legacy.parent.mkdir(parents=True); legacy.touch()
        external=self.root/'external/llama-server.exe'; external.parent.mkdir(); external.touch()
        with patch.object(runtime,'load_manifest',return_value={'runtimes':[entry]}):
            self.assertEqual(discovery.discover_server(str(external)),external.resolve())
            self.assertEqual(discovery.discover_server('AUTO',str(external.parent)),Path(result['path']))
        (runtime.managed_directory()/'active.json').unlink()
        self.assertEqual(discovery.discover_server('AUTO',str(external.parent)),legacy.resolve())
        legacy.unlink()
        self.assertEqual(discovery.discover_server('AUTO',str(external.parent)),external.resolve())
        external.unlink()
        old=self.root/'tools/KoO/llama.cpp/llama-server.exe'; old.parent.mkdir(parents=True); old.touch()
        self.assertEqual(discovery.discover_server(),old.resolve())
        old.unlink()
        with patch.object(discovery.shutil,'which',return_value=str(self.root/'path/llama-server.exe')):
            self.assertEqual(discovery.discover_server(),(self.root/'path/llama-server.exe').resolve())

    def test_invalid_override_does_not_silently_fallback(self):
        with self.assertRaises(BackendConfigurationError): discovery.discover_server(str(self.root/'missing/llama-server.exe'))
        wrong=self.root/'other.exe'; wrong.touch()
        with self.assertRaises(BackendConfigurationError): discovery.discover_server(str(wrong))

    def test_backend_free_import_and_missing_capability_errors(self):
        with patch.object(discovery.shutil,'which',return_value=None), patch('urllib.request.urlopen',side_effect=AssertionError('No network on startup')), patch('subprocess.Popen',side_effect=AssertionError('No server on startup')):
            name=NAME+'_backend_free'
            spec=importlib.util.spec_from_file_location(name,PROJECT/'__init__.py',submodule_search_locations=[str(PROJECT)])
            module=importlib.util.module_from_spec(spec); sys.modules[name]=module; spec.loader.exec_module(module)
            self.assertIn('KoOApesPrompter11',module.NODE_CLASS_MAPPINGS)
            self.assertFalse(discovery.runtime_status()['available'])

    def test_ollama_unavailable_is_feature_error(self):
        provider=providers.create_provider({'provider':'ollama_native','base_url':'http://127.0.0.1:11434'},opener=Mock(side_effect=URLError('offline')))
        with self.assertRaises(providers.ProviderError): provider.discover_models(1)

    def test_external_providers_generate_without_llama_cpp(self):
        core=importlib.import_module(NAME+'.nodes.apes_prompter11.core')
        bridge=importlib.import_module(NAME+'.nodes.apes_prompter11.provider_backend')
        base=importlib.import_module(NAME+'.nodes.apes_prompter11.providers.base')
        for preset in ['Ollama Native','Custom OpenAI Compatible']:
            provider=Mock(); provider.name='test-provider'; provider.capabilities=base.Capabilities()
            provider.generate.return_value=base.GenerationResult(text='verified prompt',provider='test-provider',model='test-model')
            with self.subTest(preset=preset), patch.object(bridge,'create_provider',return_value=provider), patch.object(bridge,'get_api_key',return_value=''), patch.object(core,'local_backend',side_effect=AssertionError('llama.cpp must not be needed')):
                request=core.PromptDirectorRequest.from_mapping({'idea':'describe a chair','provider_preset':preset,'engine_model':'test-model'})
                result=core.PromptDirectorService(config={}).generate_text_only(request)
                self.assertEqual(result.prompt,'verified prompt')

    def config(self):
        return processes.LlamaCppLaunchConfig(executable=self.root/'llama-server.exe',model_path=self.root/'model.gguf',
            mmproj_path=None,host='127.0.0.1',port=8189,context_size=8192,image_min_tokens=1024,
            gpu_layers='auto',reasoning='off',keep_model_loaded=True,max_tokens=768,timeout=30,
            startup_timeout=30,temperature=0.3,alias='test',requested_model='test')

    def test_duplicate_server_reused_and_shutdown(self):
        manager=processes.LlamaCppProcessManager(); process=Mock(); process.poll.return_value=None
        with patch.object(manager,'_start_process',return_value=process) as start, patch.object(manager,'_wait_until_ready'), patch.object(manager,'_port_available',return_value=True):
            first=manager.acquire(self.config()); second=manager.acquire(self.config())
            self.assertIs(first,second); start.assert_called_once()
            manager.release(first); manager.release(second); manager.request_unload()
        process.terminate.assert_called_once(); process.wait.assert_called_once(); self.assertIsNone(manager._owned)

    def test_popen_uses_argv_shell_false_and_drains_logs(self):
        manager=processes.LlamaCppProcessManager(); process=Mock(); process.stderr=io.BytesIO(b'log')
        with patch.object(processes.subprocess,'Popen',return_value=process) as popen:
            manager._start_process(self.config())
        self.assertIsInstance(popen.call_args.args[0],list)
        self.assertIs(popen.call_args.kwargs['shell'],False)

    def test_shutdown_escalates_to_kill_after_timeout(self):
        process=Mock(); process.poll.return_value=None; process.wait.side_effect=[subprocess.TimeoutExpired('llama-server',5),None]
        processes.LlamaCppProcessManager._terminate(SimpleNamespace(process=process))
        process.terminate.assert_called_once(); process.kill.assert_called_once()

    def test_startup_failure_cleans_owned_server(self):
        manager=processes.LlamaCppProcessManager(); process=Mock(); process.poll.return_value=None
        with patch.object(manager,'_start_process',return_value=process), patch.object(manager,'_port_available',return_value=True), patch.object(manager,'_wait_until_ready',side_effect=RuntimeError('startup failed')):
            with self.assertRaises(RuntimeError): manager.acquire(self.config())
        process.terminate.assert_called_once(); self.assertIsNone(manager._owned)

    def test_port_conflict_uses_fallback_without_killing_external_process(self):
        manager=processes.LlamaCppProcessManager()
        with patch.object(manager,'_port_available',side_effect=[False,True]):
            config=manager._runtime_config(self.config())
        self.assertEqual(config.port,8190)

    def test_premature_exit_and_missing_dll_messages(self):
        manager=processes.LlamaCppProcessManager()
        for code,message in [(1,'startup failure'),(0xc0000135,'Missing DLL')]:
            process=Mock(); process.poll.return_value=code; process._apes_errors=[]
            with self.subTest(code=code), self.assertRaisesRegex(processes.BackendGenerationError,message):
                manager._wait_until_ready(processes.OwnedLlamaServer(self.config(),process))

    def test_startup_timeout_is_reported(self):
        manager=processes.LlamaCppProcessManager(); process=Mock(); process.poll.return_value=None; process._apes_errors=[]
        with patch.object(processes.time,'monotonic',side_effect=[0,31]), self.assertRaisesRegex(processes.BackendGenerationError,'not ready'):
            manager._wait_until_ready(processes.OwnedLlamaServer(self.config(),process))

    def test_frontend_retains_busy_guards_and_progress_polling(self):
        text=(PROJECT/'web/apes_prompter11/koo_apes_prompter11.js').read_text(encoding='utf-8')
        for token in ['node._apesRuntimeMutation','button.disabled','clearInterval(timer)','runtime-repair','runtime-remove','https://ollama.com/download']:
            self.assertIn(token,text)


if __name__ == '__main__': unittest.main()

