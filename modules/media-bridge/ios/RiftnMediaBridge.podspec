Pod::Spec.new do |s|
  s.name = 'RiftnMediaBridge'
  s.version = '1.0.0'
  s.summary = 'Volume keys and live screen share picker'
  s.description = 'Reports hardware volume presses and opens the broadcast picker for live screen share.'
  s.author = 'RIFTN'
  s.homepage = 'https://riftn.com'
  s.license = { type: 'MIT' }
  s.platform = :ios, '15.1'
  s.source = { git: 'https://github.com/Riftn/riftn-mobile.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.swift_version = '5.0'
  s.source_files = '*.swift'
  s.frameworks = 'AVFoundation', 'ReplayKit', 'UIKit', 'StoreKit'
end
