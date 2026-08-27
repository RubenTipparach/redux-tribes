using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using Udar.SceneManager;
using System;
using UnityEngine.SceneManagement;
using UnityEngine.UI;
using JetBrains.Annotations;

public class MissionSelection : MonoBehaviour
{

    public int mapIndexStart = 0;

    public bool reloadMisionLoading;
    
    public MissionScenes[] missionScenes;

    public float loadProgress = 0;

    public float loadSpeedMultiplier = 2f;
    
    // Start is called before the first frame update
    void Start()
    {
        
    }

    // Update is called once per frame
    void Update()
    {
        int progressInt = Mathf.FloorToInt(loadProgress);

        if (loadProgress != (float)mapIndexStart && loadProgress <= mapIndexStart - 1f)
        {
            float sliderPercentage = loadProgress - progressInt;
            if (missionScenes[progressInt].slider != null)
            {
                missionScenes[progressInt].slider.value = sliderPercentage;
            }


            if (loadProgress < mapIndexStart)
            {
                loadProgress += Time.deltaTime * loadSpeedMultiplier;
            }
            else
            {
                loadProgress = mapIndexStart;
            }
        }

        if (!missionScenes[progressInt].missionButton.interactable)
        {
            missionScenes[progressInt].missionButton.interactable = true;
        }
        
        if (reloadMisionLoading)
        {
            ResetToZero();
            reloadMisionLoading = false;
        }
    }

    public void LoadAndUnlockMissions(GameSave gs, bool startAtLastMission = false)
    {
        mapIndexStart = gs.levelsCompleted;
    
        if (startAtLastMission && mapIndexStart > 1 && (missionScenes != null && missionScenes.Length > 0))
        {
            loadProgress = mapIndexStart - 2;

            for (int i = 0; i < mapIndexStart - 1; i++)
            {
                missionScenes[i].missionButton.interactable = true;

                if (missionScenes[i].slider != null)
                {
                    missionScenes[i].slider.value = 1;
                }
            }
        }

        //ResetToZero();
    }


    public void UnlockAllMissions()
    {
        for (int i = 0; i < missionScenes.Length; i++)
        {
            missionScenes[i].missionButton.interactable = true;

            if (missionScenes[i].slider != null)
            {
                missionScenes[i].slider.value = 1;
            }
        }
    }

    public void ResetToZero()
    {
        loadProgress = 0;
        foreach (var sceneData in missionScenes)
        {
            if (sceneData.slider != null)
            {
                sceneData.slider.value = 0;
            }

            sceneData.missionButton.interactable = false;
        }
    }

    public void LoadScene(int sceneIndex){
        SceneManager.LoadScene(missionScenes[sceneIndex].scene.Name);
    }
}

[Serializable]
public class MissionScenes {
    public SceneField scene;
    public Button missionButton;
    public Slider slider;
}