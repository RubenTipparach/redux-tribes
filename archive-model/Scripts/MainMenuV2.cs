using System.Collections;
using System.Collections.Generic;
using Unity.VisualScripting;
using UnityEngine;
using UnityEngine.SceneManagement;
using DevLocker.Utils;
using UnityEngine.UI;

public class MainMenuV2 : MonoBehaviour
{

    [SerializeField] GameObject startCampaignPrompt;
    [SerializeField] GameObject scenariosPrompt;
    [SerializeField] GameObject tutorialsPrompt;

    [SerializeField] GameObject optionsPrompt;
    [SerializeField] private SceneReference startCampaignScene;
    //[SerializeField] private SceneReference scenariosScene;
    [SerializeField] private SceneReference tutorial_1_scene;
    [SerializeField] private SceneReference[] scenariosMap;
    [SerializeField] private SceneReference[] tutorials;

    public Button continueButton;

    // Start is called before the first frame update
    void Start()
    {
        var missionLoader = FindObjectOfType<EncounterMissionLoader>();
        if (missionLoader != null)
        {
            Destroy(missionLoader.gameObject);
        }

        if (CampaignSaveSystem.SaveFileExists())
        {
            continueButton.interactable = true;
        }
    }

    // Update is called once per frame
    void Update()
    {
        
    }

    public void NewCampaign(){
        CampaignSaveSystem.DeleteSaveFile();
        startCampaignPrompt.SetActive(true);
    }

    public void ContinueSaveFile()
    {
        // todo add loading screen?
        SceneManager.LoadScene(startCampaignScene.SceneName);
    }

    public void CloseCapaignStartPrompt()
    {
        startCampaignPrompt.SetActive(false);

    }
    
    public void StartCampaign(){
        SceneManager.LoadScene(startCampaignScene.SceneName);
    }

    // public void StartTutorial(){
    //     SceneManager.LoadScene(tutorial_1_scene.SceneName);
    // }


    // public void Scenarios(){
    //     scenariosPrompt.SetActive(true);
    // }


    public void StartScenarios(){
        scenariosPrompt.SetActive(true);
    }

    public void StartTutorials(){
        tutorialsPrompt.SetActive(true);
    }


    public void StartTutorialsScene(int index)
    {
        SceneManager.LoadScene(tutorials[index].SceneName);
    }

    public void StartScenarioScene(int index)
    {
        SceneManager.LoadScene(scenariosMap[index].SceneName);
    }

    public void CloseScenarios()
    {
        scenariosPrompt.SetActive(false);
    }

    public void CloseTutorials()
    {
        tutorialsPrompt.SetActive(false);
    }

    public void Options(){
        optionsPrompt.SetActive(true);
    }

    public void CloseOptions(){
        optionsPrompt.SetActive(false);
    }

    public void Quit(){
        Application.Quit();
        
    }

}
