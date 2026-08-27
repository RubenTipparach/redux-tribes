using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using Udar.SceneManager;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

public class MenuManager : MonoBehaviour
{
    public ShipPrefabLibrary shipPrefabLibrary;
    public FactionInfoLibrary factionInfoLibrary;

    public static ShipPrefabLibrary CentralShipLibrary;

    public static FactionInfoLibrary FactionInfoLibrary;

    public GameSave gameSave = new GameSave();

    public MissionSelection missionSelection;

    public SceneField menuScene;

    private void Awake()
    {
        CentralShipLibrary = shipPrefabLibrary;
        FactionInfoLibrary = factionInfoLibrary;
    }

    // Start is called before the first frame update
    void Start()
    {

        //LoadGame();
        //missionSelection.LoadAndUnlockMissions(gameSave, true);
        missionSelection.UnlockAllMissions();
    }

    // Update is called once per frame
    void Update()
    {
        
    }

    public void LoadGame()
    {
        if (!gameSave.LoadGame())
        {
            // reseting game.
            ResetGame();
        }else{
            
        }
    }

    public void SaveGame(){
        gameSave.SaveGame();
    }

    public void ResetGame(){
        var gs = new GameSave()
        {
            ships = new List<ShipUnit>()
            {
                new ShipUnit(){
                    shipFaction = ShipFaction.Terran,
                    shipType = ShipType.LightFrigate,
                    shipName = "Clearescence",
                    shipRegistryNumber = "ETFS 199-871",
                    variant = "A",
                    crewAllocated = 120
                }
            },
            levelsCompleted = 0,
            crewTotal = 120
        };


        gameSave = gs;

        gameSave.SaveGame();
    }

    public void Quit()
    {
        //Application.Quit();
        SceneManager.LoadScene(menuScene.Name);
    }
}

[Serializable]
public class GameSave{
    public List<ShipUnit> ships;

    public int levelsCompleted;

    public int crewTotal;

    public bool LoadGame()
    {
        string path = Application.persistentDataPath + "/savefile.json";
        Debug.Log("path: " + path);

        if (File.Exists(path))
        {
            string json = File.ReadAllText(path);
            var gs = JsonUtility.FromJson<GameSave>(json);

            this.ships = gs.ships;
            this.levelsCompleted = gs.levelsCompleted;
            this.crewTotal = gs.crewTotal;

            return true;
        }
        else
        {

            Debug.LogError("Save file not found in " + path);

            // reseting game.
            // ResetGame();
            return false;
        }
    }

    public void SaveGame(){
        string json = JsonUtility.ToJson(this);
        File.WriteAllText(Application.persistentDataPath + "/savefile.json", json);

        Debug.Log(json);

    }
}

[Serializable]
public class ShipUnit{
    public ShipFaction shipFaction;
    public ShipType shipType;
    public string shipName;
    public string shipRegistryNumber;
    public string variant= "A";
    public int crewAllocated = 50;
    public int marinesAllocated = 15;
}
