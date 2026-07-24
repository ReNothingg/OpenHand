//
//  openhandApp.swift
//  openhand
//
//  Created by Павел on 7/24/26.
//

import SwiftUI

@main
struct openhandApp: App {
    var body: some Scene {
        WindowGroup("Чернильник", id: "main") {
            ContentView()
        }
        .defaultSize(width: 1440, height: 900)
        .commands {
            CommandGroup(replacing: .newItem) { }
        }
    }
}
