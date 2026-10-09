Pod::Spec.new do |s|
  s.name = 'CampusGoogleCredential'
  s.version = '0.1.0'
  s.summary = 'Native Google sign-in for nuni.'
  s.description = 'Nonce-bound Google ID tokens for server-side authentication.'
  s.author = 'nuni'
  s.homepage = 'https://nuni.tw'
  s.license = { :type => 'UNLICENSED' }
  s.platforms = { :ios => '15.1' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  # 9.0 adds the nonce API required by the server's single-use login transaction.
  s.dependency 'GoogleSignIn', '9.0.0'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
end
