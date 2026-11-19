Pod::Spec.new do |s|
  s.name = 'RiftnCallScreen'
  s.version = '1.0.0'
  s.summary = 'Incoming call screen'
  s.description = 'Rings incoming Riftn calls on the iPhone call screen (CallKit), woken by VoIP pushes (PushKit).'
  s.author = 'RIFTN'
  s.homepage = 'https://riftn.com'
  s.license = { type: 'MIT' }
  s.platform = :ios, '15.1'
  s.source = { git: 'https://github.com/Riftn/riftn-mobile.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.swift_version = '5.0'
  s.source_files = '*.swift'
  s.frameworks = 'AVFoundation', 'CallKit', 'PushKit', 'UIKit'
end
