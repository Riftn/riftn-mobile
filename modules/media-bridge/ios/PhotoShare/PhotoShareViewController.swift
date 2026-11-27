import UIKit
import UniformTypeIdentifiers

final class PhotoShareViewController: UIViewController {
  private var started = false

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !started else { return }
    started = true
    savePhoto()
  }

  private func savePhoto() {
    guard let items = extensionContext?.inputItems as? [NSExtensionItem],
      let provider = items.flatMap({ $0.attachments ?? [] }).first(where: { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }),
      let type = provider.registeredTypeIdentifiers.compactMap({ UTType($0) })
        .first(where: { $0.conforms(to: .image) && $0.preferredFilenameExtension != nil })
    else {
      showResult(copy.error)
      return
    }

    provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { [weak self] source, _ in
      let saved: Bool
      do {
        guard let source else { throw CocoaError(.fileReadUnknown) }
        try SharedPhotoImport.enqueue(source, type: type)
        saved = true
      } catch {
        saved = false
      }
      DispatchQueue.main.async {
        guard let self else { return }
        self.showResult(saved ? self.copy.ready : self.copy.error)
      }
    }
  }

  private func showResult(_ message: String) {
    let alert = UIAlertController(title: "Riftn", message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: copy.done, style: .default) { [weak self] _ in
      self?.extensionContext?.completeRequest(returningItems: nil)
    })
    present(alert, animated: true)
  }

  private typealias Strings = (ready: String, error: String, done: String)
  private var copy: Strings {
    switch Locale.preferredLanguages.first?.split(separator: "-").first {
    case "ar": return ("افتح Riftn لمتابعة كتابة المنشور.", "تعذّرت إضافة الصورة.", "تم")
    case "es": return ("Abre Riftn para continuar con la publicación.", "No se pudo añadir la foto.", "Listo")
    case "fr": return ("Ouvrez Riftn pour continuer votre publication.", "Impossible d’ajouter la photo.", "Terminé")
    case "nl": return ("Open Riftn om verder te gaan met je bericht.", "De foto kon niet worden toegevoegd.", "Gereed")
    case "tr": return ("Gönderiye devam etmek için Riftn’i açın.", "Fotoğraf eklenemedi.", "Bitti")
    default: return ("Open Riftn to continue your post.", "Couldn’t add the photo.", "Done")
    }
  }
}
