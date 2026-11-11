Pod::Spec.new do |s|
  s.name = 'CampusStudentCardNfc'
  s.version = '0.1.0'
  s.summary = 'Foreground NFC reading for nuni student-card tokens.'
  s.description = 'Core NFC reader for the private nuni ISO 7816 application.'
  s.author = 'nuni'
  s.homepage = 'https://nuni.tw'
  s.license = { :type => 'UNLICENSED' }
  s.platforms = { :ios => '15.1' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.frameworks = 'CoreNFC'
end
