Pod::Spec.new do |s|
  s.name = 'CampusNextClass'
  s.version = '1.0.0'
  s.summary = 'Shared next class snapshot for nuni.'
  s.description = 'Device-only timetable snapshot bridge.'
  s.author = 'nuni'
  s.homepage = 'https://nuni.tw'
  s.license = { :type => 'UNLICENSED' }
  s.platforms = { :ios => '15.1' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.frameworks = 'WidgetKit'
end
